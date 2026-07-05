function trim(str) {
	if (!str || !str.replace) str='';
  	return str.replace(/^\s*|\s*$/g,"");
}
function number_format(number, decimals, dec_point, thousands_sep) {
  number = (number + '').replace(/[^0-9+\-Ee.]/g, '');
  var n = !isFinite(+number) ? 0 : +number,
    prec = !isFinite(+decimals) ? 0 : Math.abs(decimals),
    sep = (typeof thousands_sep === 'undefined') ? ',' : thousands_sep,
    dec = (typeof dec_point === 'undefined') ? '.' : dec_point,
    s = '',
    toFixedFix = function (n, prec) {
      var k = Math.pow(10, prec);
      return '' + Math.round(n * k) / k;
    };
  s = (prec ? toFixedFix(n, prec) : '' + Math.round(n)).split('.');
  if (s[0].length > 3) {
    s[0] = s[0].replace(/\B(?=(?:\d{3})+(?!\d))/g, sep);
  }
  if ((s[1] || '').length < prec) {
    s[1] = s[1] || '';
    s[1] += new Array(prec - s[1].length + 1).join('0');
  }
  return s.join(dec);
}

var func_name='nanotts';
var wasmBasePath='../wasm_tts_voices/nano/';
var langBasePath='../nanotts/ttslang/';
var ttslangs={"de-DE":["de-DE_gl0_sg.bin","de-DE_ta.bin",634996,440732],"en-GB":["en-GB_kh0_sg.bin","en-GB_ta.bin",584436,412248],"en-US":["en-US_lh0_sg.bin","en-US_ta.bin",777396,650668],"es-ES":["es-ES_ta.bin","es-ES_zl0_sg.bin",256744,605280],"fr-FR":["fr-FR_nk0_sg.bin","fr-FR_ta.bin",833236,381936],"it-IT":["it-IT_cm0_sg.bin","it-IT_ta.bin",628268,252044]};	

var self2=self;

function go(){
	self2.onmessage = function(event) {
		try{
			var message = event.data;
		
			function print_nanotts(s){
				//console.log(s);
			}

			var langobj=ttslangs[message.lang];
			if(!langobj){
				postMessage({'type': 'progress', 'error': 'No found a language file.'});
				return;
			}
			if(!gwasmbinary[langBasePath+langobj[0]] || !gwasmbinary[langBasePath+langobj[1]]){
				postMessage({'type': 'progress', 'data':'Loading library... Please wait a moment.'});	
			}
			_getwasmbinary(wasmBasePath+func_name+'.wasm',function(wb){
			_getwasmbinary(langBasePath+langobj[0],function(langdata1){
			_getwasmbinary(langBasePath+langobj[1],function(langdata2){
				try{
					postMessage({'type': 'progress', 'data':'Converting.. Please wait...'});	

					var argument1=['-l','/','-i',message.text,'-v',message.lang];			
					if(message.volume==null) message.volume=0.5;
					argument1.push('--volume'); argument1.push(message.volume+'');
					argument1.push('-o'); argument1.push('output.wav');

					var Module2 = {wasmBinary:wb, files: message.files, arguments: argument1, print: print_nanotts, printErr: print_nanotts};
					nanotts_run(Module2, function(FS){
						FS.createDataFile('/', langobj[0], langdata1, true, true);
						FS.createDataFile('/', langobj[1], langdata2, true, true);
					},function(results){
						//console.log(results);
						var arr=[];
						for(var i = 0; i<=results.length-1; i++){						
							if(/\.(wav)$/i.test(results[i].name) && /^(output)/i.test(results[i].name)){												
								var blob = new Blob([results[i].data], {type: "audio/wav"});
								postMessage({'blob':blob});
								return;
							}
						}
						postMessage({'type': 'progress', 'error': 'Failed to process a file.'});
					});	
				}catch(err){
					postMessage({'type': 'progress', 'error':err+''});
				}
			},true,langobj[3]);
			},true,langobj[2]);
			},'',538859);
		}catch(err){
			postMessage({'type': 'progress', 'error':err+''});
		}
	}
}


var gwasmbinary={};
function _getwasmbinary(fname, callback, isu8arr, estimatesize){
	if(gwasmbinary[fname]){
		callback(gwasmbinary[fname]);return;
	}
	try{
		var xhr = new XMLHttpRequest();
		xhr.open('GET', fname, true);
		xhr.responseType = 'arraybuffer';
		var lastprogress=(new Date()).getTime();
		xhr.onprogress=function(event){
			if(lastprogress){
				var elaspetime = new Date();
				var dt=elaspetime.getTime()-lastprogress;
				if(dt<200)return;
				lastprogress=elaspetime.getTime();
			}
			var a=event;
			var total=a.totalSize || a.total || estimatesize || 0;
			var current=a.position || a.loaded  || 0;
			if(isu8arr){
				postMessage({'type': 'progress', 'data':'Downloading a library... ('+number_format(current)+'/'+number_format(total)+')'});
			}
		};
	    xhr.onload = function(){
			if(this.status == 200){
				if(isu8arr) gwasmbinary[fname]=new Uint8Array(this.response);
				else gwasmbinary[fname]=this.response;
				callback(gwasmbinary[fname]);
			}else{
				postMessage({'type': 'progress', 'error':'Failed to fetch the library.'});
			}
		};
		xhr.onerror = function(e){      
			postMessage({'type': 'progress', 'error':'Failed to fetch the library (1).'});
		};
		xhr.send();
	}catch(err){
		postMessage({'type': 'progress', 'error':err+''});
	}
}

importScripts(func_name+'.js');
_getwasmbinary(wasmBasePath+func_name+'.wasm',function(wb){
	go();
	postMessage({'type': 'ready'});	
},'',538859);
