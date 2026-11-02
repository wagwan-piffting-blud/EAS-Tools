# syntax=docker/dockerfile:1.7

ARG CHROMIUM_PACKAGE=chromium-headless-shell
ARG CHROMIUM_BINARY=/usr/lib/chromium/chromium-headless-shell

FROM rust:trixie AS build
WORKDIR /build
COPY test/e2e-rs/Cargo.toml test/e2e-rs/Cargo.lock test/e2e-rs/
COPY test/e2e-rs/src test/e2e-rs/src
COPY test/e2e-rs/suites test/e2e-rs/suites
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/test/e2e-rs/target \
    find test/e2e-rs/target/release/deps -maxdepth 1 -type f -name 'e2e-*' -perm /111 -delete 2>/dev/null || true; \
    cargo test --locked --release --manifest-path test/e2e-rs/Cargo.toml --test e2e --no-run && \
    find test/e2e-rs/target/release/deps -maxdepth 1 -type f -name 'e2e-*' -perm /111 -exec cp '{}' /tmp/eas-tools-e2e \; && \
    test -x /tmp/eas-tools-e2e

FROM debian:trixie-slim AS chromium-runtime
ARG CHROMIUM_PACKAGE
ARG CHROMIUM_BINARY
RUN apt-get update && \
    apt-get install --yes --no-install-recommends ${CHROMIUM_PACKAGE} fonts-liberation pax-utils && \
    rm -rf /var/lib/apt/lists/*
COPY --from=build /tmp/eas-tools-e2e /usr/local/bin/eas-tools-e2e
RUN mkdir -p /runtime/usr/local/bin /runtime/usr/lib /runtime/etc /runtime/usr/share/fonts && \
    cp /usr/local/bin/eas-tools-e2e /runtime/usr/local/bin/eas-tools-e2e && \
    cp -a /usr/lib/chromium /runtime/usr/lib/chromium && \
    cp -a /etc/fonts /runtime/etc/fonts && \
    cp -a /usr/share/fonts/truetype /runtime/usr/share/fonts/ && \
    { lddtree -l /usr/local/bin/eas-tools-e2e; lddtree -l ${CHROMIUM_BINARY}; } | sort -u > /tmp/runtime-libs && \
    while IFS= read -r library; do \
        case "$library" in /lib/*|/lib64/*) destination="/runtime/usr$library" ;; *) destination="/runtime$library" ;; esac; \
        mkdir -p "$(dirname "$destination")"; \
        cp -L "$library" "$destination"; \
    done < /tmp/runtime-libs

FROM debian:trixie-slim AS app-content
WORKDIR /workspace
COPY *.html favicon.ico ./
COPY assets assets
COPY warngen warngen
COPY test/e2e-rs/vendor test/e2e-rs/vendor
COPY test/e2e-rs/fixtures test/e2e-rs/fixtures
RUN if grep -q '^version https://git-lfs.github.com/spec/' assets/wasm_tts_voices/espeak/espeak-ng.eas.data; then \
        echo 'eSpeak E2E data is still a Git LFS pointer; run git lfs pull --include=assets/wasm_tts_voices/espeak/espeak-ng.eas.data' >&2; \
        exit 1; \
    fi

FROM gcr.io/distroless/static-debian13:nonroot
ARG CHROMIUM_BINARY
COPY --from=chromium-runtime /runtime/ /
COPY --from=app-content --chown=nonroot:nonroot /workspace /workspace
WORKDIR /workspace
ENV EAS_TOOLS_CHROME=${CHROMIUM_BINARY} \
    EAS_TOOLS_HEADLESS=1 \
    EAS_TOOLS_REPO_ROOT=/workspace \
    HOME=/tmp
ENTRYPOINT ["/usr/local/bin/eas-tools-e2e"]
