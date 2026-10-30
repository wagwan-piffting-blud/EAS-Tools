use std::collections::HashMap;
use std::io::{BufRead, BufReader, BufWriter, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

const PREFIX: &str = "/eas-tools";
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);

type Cache = Arc<Mutex<HashMap<PathBuf, Arc<Vec<u8>>>>>;

/// Serves the repository under `/eas-tools` the way Laragon lays it out, straight from
/// disk with an in-memory cache, so the suite needs neither Apache nor a Python server.
///
/// One OS thread per connection. This replaced tiny_http 0.12, whose task pool can lose a
/// wakeup: a connection accepted while a woken worker has not yet run sits queued until some
/// other keep-alive connection closes, which showed up as a navigation stalling for ~30 s.
pub fn start(root: PathBuf) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the static server");
    let port = listener.local_addr().expect("listener address").port();
    let cache: Cache = Arc::new(Mutex::new(HashMap::new()));
    thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(stream) = stream else { continue };
            let root = root.clone();
            let cache = Arc::clone(&cache);
            thread::spawn(move || {
                let _ = handle_connection(stream, &root, &cache);
            });
        }
    });
    format!("http://127.0.0.1:{port}{PREFIX}")
}

struct Request {
    method: String,
    target: String,
    keep_alive: bool,
    range: Option<String>,
}

fn handle_connection(stream: TcpStream, root: &Path, cache: &Cache) -> std::io::Result<()> {
    stream.set_nodelay(true)?;
    stream.set_read_timeout(Some(IDLE_TIMEOUT))?;
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut writer = BufWriter::with_capacity(64 * 1024, stream);
    loop {
        let Some(request) = read_request(&mut reader)? else { return Ok(()) };
        let t0 = Instant::now();
        respond(&mut writer, &request, root, cache)?;
        writer.flush()?;
        trace(&request, t0);
        if !request.keep_alive {
            return Ok(());
        }
    }
}

fn read_request(reader: &mut BufReader<TcpStream>) -> std::io::Result<Option<Request>> {
    let mut line = String::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Ok(None);
        }
        if !line.trim().is_empty() {
            break;
        }
    }
    let mut parts = line.split_whitespace();
    let (Some(method), Some(target), version) = (parts.next(), parts.next(), parts.next().unwrap_or("HTTP/1.0")) else {
        return Ok(None);
    };
    let mut keep_alive = version.eq_ignore_ascii_case("HTTP/1.1");
    let mut range = None;
    let mut body_len = 0usize;
    let mut chunked = false;
    loop {
        let mut header = String::new();
        if reader.read_line(&mut header)? == 0 {
            return Ok(None);
        }
        let header = header.trim_end();
        if header.is_empty() {
            break;
        }
        let Some((name, value)) = header.split_once(':') else { continue };
        let value = value.trim();
        match name.trim().to_ascii_lowercase().as_str() {
            "connection" => {
                let v = value.to_ascii_lowercase();
                if v.contains("close") {
                    keep_alive = false;
                } else if v.contains("keep-alive") {
                    keep_alive = true;
                }
            }
            "range" => range = Some(value.to_string()),
            "content-length" => body_len = value.parse().unwrap_or(0),
            "transfer-encoding" => chunked = value.to_ascii_lowercase().contains("chunked"),
            _ => {}
        }
    }
    if body_len > 0 {
        std::io::copy(&mut reader.by_ref().take(body_len as u64), &mut std::io::sink())?;
    }
    if chunked {
        keep_alive = false;
    }
    Ok(Some(Request { method: method.to_string(), target: target.to_string(), keep_alive, range }))
}

fn respond(out: &mut impl Write, request: &Request, root: &Path, cache: &Cache) -> std::io::Result<()> {
    let head_only = request.method.eq_ignore_ascii_case("HEAD");
    let connection = if request.keep_alive { "keep-alive" } else { "close" };
    let raw = request.target.split(['?', '#']).next().unwrap_or("/");
    let Some(rel) = raw.strip_prefix(PREFIX) else {
        return empty(out, 404, "Not Found", connection);
    };
    let rel = percent_decode(rel.trim_start_matches('/'));
    if rel.split('/').any(|part| part == "..") {
        return empty(out, 403, "Forbidden", connection);
    }
    let mut path = root.join(&rel);
    if path.is_dir() {
        path = path.join("index.html");
    }
    let Some(body) = load(&path, cache) else {
        return empty(out, 404, "Not Found", connection);
    };
    let mime = content_type(&path);
    let range = request.range.as_deref().and_then(|r| parse_range(r, body.len()));
    let (status, reason, start, end) = match range {
        Some((s, e)) => (206, "Partial Content", s, e + 1),
        None => (200, "OK", 0, body.len()),
    };
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {mime}\r\nAccept-Ranges: bytes\r\nCache-Control: max-age=3600\r\nContent-Length: {}\r\nConnection: {connection}\r\n",
        end - start
    );
    if range.is_some() {
        head.push_str(&format!("Content-Range: bytes {start}-{}/{}\r\n", end - 1, body.len()));
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())?;
    if !head_only {
        out.write_all(&body[start..end])?;
    }
    Ok(())
}

fn empty(out: &mut impl Write, status: u16, reason: &str, connection: &str) -> std::io::Result<()> {
    write!(out, "HTTP/1.1 {status} {reason}\r\nContent-Length: 0\r\nConnection: {connection}\r\n\r\n")
}

fn load(path: &Path, cache: &Cache) -> Option<Arc<Vec<u8>>> {
    if let Some(hit) = cache.lock().unwrap().get(path) {
        return Some(Arc::clone(hit));
    }
    let bytes = Arc::new(std::fs::read(path).ok()?);
    cache.lock().unwrap().insert(path.to_path_buf(), Arc::clone(&bytes));
    Some(bytes)
}

fn content_type(path: &Path) -> String {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "js" | "mjs" => "text/javascript; charset=utf-8".into(),
        "wasm" => "application/wasm".into(),
        "json" => "application/json; charset=utf-8".into(),
        "html" => "text/html; charset=utf-8".into(),
        "css" => "text/css; charset=utf-8".into(),
        "pmtiles" | "data" | "vin" | "vdb" | "ar2v" => "application/octet-stream".into(),
        _ => mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string(),
    }
}

fn parse_range(value: &str, len: usize) -> Option<(usize, usize)> {
    let spec = value.strip_prefix("bytes=")?;
    if spec.contains(',') || len == 0 {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let suffix: usize = b.parse().ok()?;
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start: usize = a.parse().ok()?;
        let end = if b.is_empty() { len - 1 } else { b.parse::<usize>().ok()?.min(len - 1) };
        (start, end)
    };
    (start <= end && start < len).then_some((start, end))
}

fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&input[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// With EAS_TOOLS_SERVER_LOG=1, appends one line per request to %TEMP%\eas-tools-e2e-server.log.
fn trace(request: &Request, t0: Instant) {
    static LOG: Mutex<Option<(Instant, std::fs::File)>> = Mutex::new(None);
    if std::env::var("EAS_TOOLS_SERVER_LOG").map(|v| v != "1").unwrap_or(true) {
        return;
    }
    let mut guard = LOG.lock().unwrap();
    if guard.is_none() {
        if let Ok(f) = std::fs::File::create(std::env::temp_dir().join("eas-tools-e2e-server.log")) {
            *guard = Some((Instant::now(), f));
        }
    }
    if let Some((start, f)) = guard.as_mut() {
        let _ = writeln!(f, "{:>8} {}ms {} {}", start.elapsed().as_millis(), t0.elapsed().as_millis(), request.method, request.target);
    }
}
