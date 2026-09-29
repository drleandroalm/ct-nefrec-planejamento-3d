/* static-shim.js — build estático (GitHub Pages).
   O servidor local (serve.py) entregava arquivos binários grandes já comprimidos (Content-Encoding: gzip).
   O GitHub Pages não faz isso para .raw/.bin/.glb, então o build guarda só "<arquivo>.gz" e este shim
   intercepta fetch() dos arquivos listados em GZMAP, baixa o .gz e descomprime no navegador (DecompressionStream).
   Se o servidor já tiver descomprimido (Content-Encoding aplicado), os bytes passam direto. */
(function () {
  "use strict";
  var GZMAP = {"dados/cir_gt/cir_gt.glb":{"gz":"dados/cir_gt/cir_gt.glb.gz","size":5577880},"dados/corrected/kidney_left_corrected.glb":{"gz":"dados/corrected/kidney_left_corrected.glb.gz","size":1398012},"dados/glb/nefrec_surgical_axisfixed.glb":{"gz":"dados/glb/nefrec_surgical_axisfixed.glb.gz","size":44725512},"dados/ureter_gonadal/ureter_gonadal.glb":{"gz":"dados/ureter_gonadal/ureter_gonadal.glb.gz","size":1629244},"dados/viewer_assets/compressed/surgical_scene_lite.meshopt.glb":{"gz":"dados/viewer_assets/compressed/surgical_scene_lite.meshopt.glb.gz","size":554532},"dados/viewer_assets_gt/compressed/optional_layers.meshopt.glb":{"gz":"dados/viewer_assets_gt/compressed/optional_layers.meshopt.glb.gz","size":999996},"dados/viewer_assets_gt/compressed/surgical_scene_lite.meshopt.glb":{"gz":"dados/viewer_assets_gt/compressed/surgical_scene_lite.meshopt.glb.gz","size":603420}};
  var ROOT = new URL("../", document.baseURI);
  var byPath = new Map();
  Object.keys(GZMAP).forEach(function (k) {
    byPath.set(new URL(k, ROOT).pathname, { gz: new URL(GZMAP[k].gz, ROOT).pathname, size: GZMAP[k].size });
  });
  window.__STATIC_BUILD__ = { gzFiles: byPath.size, root: ROOT.pathname };
  if (!byPath.size || typeof window.fetch !== "function") return;
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, document.baseURI); }
    catch (e) { return origFetch(input, init); }
    var hit = url.origin === location.origin ? byPath.get(url.pathname) : null;
    if (!hit || typeof DecompressionStream === "undefined") return origFetch(input, init);
    var opts = Object.assign({}, init || {});
    if (input instanceof Request && !opts.signal) opts.signal = input.signal;
    return origFetch(hit.gz + url.search, opts).then(function (r) {
      if (!r.ok || !r.body) return r;
      var reader = r.body.getReader();
      return reader.read().then(function (first) {
        var v = first.value;
        var isGz = !!(v && v.length > 1 && v[0] === 0x1f && v[1] === 0x8b);
        var stream = new ReadableStream({
          start: function (c) { if (v) c.enqueue(v); if (first.done) c.close(); },
          pull: function (c) { return reader.read().then(function (x) { if (x.done) c.close(); else c.enqueue(x.value); }); },
          cancel: function (why) { return reader.cancel(why); }
        });
        var body = isGz ? stream.pipeThrough(new DecompressionStream("gzip")) : stream;
        return new Response(body, { status: 200, statusText: "OK",
          headers: { "Content-Type": "application/octet-stream", "Content-Length": String(hit.size) } });
      });
    });
  };
})();
