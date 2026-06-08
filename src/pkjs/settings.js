"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSettings = buildSettings;
exports.saveSettings = saveSettings;
var helper_1 = require("./helper");
var OSR_API_KEY = 'ors_api_key';
function buildSettings() {
    var key = localStorage.getItem(OSR_API_KEY) || '';
    var destinations = (0, helper_1.loadDestinations)();
    var units = (0, helper_1.loadUnits)();
    var html = '';
    html +=
        '<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">';
    html += '<style>';
    html +=
        'body{font-family:sans-serif;padding:16px;background:#1a1a2e;color:#eee;max-width:400px;margin:0 auto}';
    html += 'h1{color:#4fc3f7;font-size:20px;margin:0 0 16px}';
    html +=
        '.dest{padding:8px;margin:4px 0;background:#16213e;border-radius:6px;display:flex;gap:8px}';
    html += '.dest-name{font-size:14px;flex:1;overflow-wrap:break-word;align-content: center;}';
    html +=
        '.del-btn{background:#e74c3c;border:none;color:#fff;border-radius:4px;padding:4px 10px;cursor:pointer;font-size:14px;line-height:1;flex-shrink:0;width: 30px;align-content: center;}';
    html += '.input-wrap{position:relative}';
    html +=
        'input{width:100%;padding:8px;margin:8px 0;border:1px solid #333;border-radius:4px;background:#0f3460;color:#eee;box-sizing:border-box}';
    html +=
        'button{background:#4fc3f7;color:#1a1a2e;border:none;padding:10px 20px;border-radius:6px;cursor:pointer;font-weight:bold;width:100%}';
    html += '.empty{color:#666;text-align:center;padding:20px}';
    html +=
        '.suggestions{position:absolute;top:100%;left:0;right:0;background:#16213e;border:1px solid #333;border-radius:0 0 4px 4px;max-height:200px;overflow-y:auto;z-index:10;display:none;list-style:none;padding:0;margin:0}';
    html += '#list{list-style:none;padding:0;margin:0}';
    html += '.suggestions li{padding:8px;cursor:pointer;font-size:13px;border-bottom:1px solid #333}';
    html += '.suggestions li:hover{background:#0f3460}';
    html += '.section-title{color:#4fc3f7;font-size:14px;margin:16px 0 8px}';
    html += '.notice{font-size:11px;color:#888;padding:16px 0 0;line-height:1.5}';
    html += '.notice a{color:#4fc3f7}';
    html += '.notice strong{color:#aaa}';
    html += '</style></head><body>';
    html += '<h1>Saved Destinations</h1>';
    html += '<ul id="list"></ul>';
    html += '<div class="section-title">Add Destination</div>';
    html += '<input type="text" id="name" placeholder="Label (optional)" autocomplete="off">';
    html += '<div class="input-wrap">';
    html += '<input type="text" id="addr" placeholder="Type address or lat,lng" autocomplete="off">';
    html += '<ul id="suggestions" class="suggestions"></ul>';
    html += '</div>';
    html += '<button onclick="addDest()">Add Destination</button>';
    html += '<div class="section-title">API Key</div>';
    html +=
        '<input class="key-input" type="text" id="apiKey" placeholder="OpenRouteService API key" value="' +
            key +
            '">';
    html += '<div class="section-title">Units</div>';
    html += '<div style="display:flex;gap:8px;margin:8px 0">';
    html += '<label style="flex:1;text-align:center;padding:8px;background:#0f3460;border-radius:6px;cursor:pointer">';
    html += '<input type="radio" name="units" value="metric"' + (units === 'metric' ? ' checked' : '') + '> km / m';
    html += '</label>';
    html += '<label style="flex:1;text-align:center;padding:8px;background:#0f3460;border-radius:6px;cursor:pointer">';
    html += '<input type="radio" name="units" value="imperial"' + (units === 'imperial' ? ' checked' : '') + '> mi / ft';
    html += '</label>';
    html += '</div>';
    html += '<button onclick="saveAndClose()">Save & Close</button>';
    if (!key)
        html +=
            '<div class="notice">Coordinates (lat,lng) always work. For address lookup, create an account at <a href="https://account.heigit.org/manage/key" target="_blank">account.heigit.org/manage/key</a> and paste the API key above. I am not affiliated with heigit.</div>';
    html += '<div class="section-title">Attributions</div>';
    html +=
        '<div class="notice">&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap contributors</a>. Map data licensed under the Open Database License (ODbL). Routing by <a href="http://project-osrm.org/" target="_blank">OSRM</a>. Geocoding by <a href="https://openrouteservice.org/" target="_blank">OpenRouteService</a>.</div>';
    html += '<script>';
    html += 'var dests = ' + JSON.stringify(destinations) + ';';
    html += 'function render(){var l=document.getElementById("list");';
    html +=
        'if(dests.length===0){l.innerHTML="<li class=\'empty\'>No saved destinations</li>";return}';
    html +=
        'l.innerHTML=dests.map(function(d,i){return"<li class=\'dest\'><span class=\'dest-name\'>"+(d.name||d.lat+","+d.lng)+"</span><button class=\'del-btn\' onclick=\'remove("+i+")\'>X</button></li>"}).join("");}';
    html += 'function remove(i){dests.splice(i,1);render();}';
    html += 'var _timer=null;';
    html +=
        'document.getElementById("addr").addEventListener("input",function(){clearTimeout(_timer);var v=this.value.trim();var sug=document.getElementById("suggestions");if(v.length<3||/^-?\\d/.test(v)){sug.style.display="none";return}_timer=setTimeout(function(){var xhr=new XMLHttpRequest();xhr.open("GET","https://api.openrouteservice.org/geocode/autocomplete?api_key="+encodeURIComponent(document.getElementById("apiKey").value)+"&text="+encodeURIComponent(v)+"&size=5",true);xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){var data=JSON.parse(xhr.responseText);if(data.features&&data.features.length){sug.innerHTML=data.features.map(function(f,i){return"<li onclick=\'pickSuggestion("+i+")\'>"+(f.properties.label||f.properties.name)+"</li>"}).join("");window._sugs=data.features;sug.style.display="block"}else{sug.style.display="none"}}};xhr.send()},300)});';
    html +=
        'document.getElementById("addr").addEventListener("blur",function(){setTimeout(function(){document.getElementById("suggestions").style.display="none"},200)});';
    html +=
        'function pickSuggestion(i){var f=window._sugs[i];if(!f)return;var c=f.geometry.coordinates;var nm=document.getElementById("name").value.trim()||f.properties.label||f.properties.name;dests.push({lat:c[1],lng:c[0],name:nm});document.getElementById("addr").value="";document.getElementById("name").value="";document.getElementById("suggestions").style.display="none";window._sugs=null;render()}';
    html +=
        'function addDest(){var addr=document.getElementById("addr").value.trim();if(!addr)return;var nm=document.getElementById("name").value.trim();var parts=addr.split(",").map(function(s){return parseFloat(s.trim())});if(parts.length===2&&!isNaN(parts[0])&&!isNaN(parts[1])){dests.push({lat:parts[0],lng:parts[1],name:nm||addr});document.getElementById("addr").value="";document.getElementById("name").value="";render();return}var xhr=new XMLHttpRequest();xhr.open("GET","https://api.openrouteservice.org/geocode/search?api_key="+encodeURIComponent(document.getElementById("apiKey").value)+"&text="+encodeURIComponent(addr)+"&size=1",true);xhr.onload=function(){if(xhr.status>=200&&xhr.status<300){var d=JSON.parse(xhr.responseText);if(d.features&&d.features.length){var c=d.features[0].geometry.coordinates;dests.push({lat:c[1],lng:c[0],name:nm||d.features[0].properties.label||addr});document.getElementById("addr").value="";document.getElementById("name").value="";render()}else{alert("Not found")}}};xhr.send()}';
    html +=
        'function saveAndClose(){var u=document.querySelector(\'input[name="units"]:checked\');var payload={destinations:dests,ors_api_key:document.getElementById("apiKey").value,units:u?u.value:"metric"};document.location="pebblejs://close#"+encodeURIComponent(JSON.stringify(payload))}';
    html += 'render();';
    html += '<\/script></body></html>';
    return html;
}
function saveSettings(response) {
    try {
        var data = JSON.parse(decodeURIComponent(response));
        if (data.destinations) {
            (0, helper_1.saveDestinations)(data.destinations);
        }
        if (data.ors_api_key) {
            localStorage.setItem(OSR_API_KEY, data.ors_api_key);
        }
        else {
            localStorage.removeItem(OSR_API_KEY);
        }
        if (data.units) {
            (0, helper_1.saveUnits)(data.units);
        }
    }
    catch (err) {
        console.log('Config parse error: ' + err);
    }
    return [];
}
