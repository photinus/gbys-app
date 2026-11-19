(function () {
  var s = document.currentScript, a = document.createElement("a");
  if (!s || !s.src) return;
  a.href = s.src;
  var o = a.protocol + "//" + a.host;
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (e.origin !== o || !d || d.type !== "gbys:contact:height") return;
    var h = Number(d.height);
    if (!(h > 0 && h < 20000)) return;
    var f = document.getElementsByTagName("iframe");
    for (var i = 0; i < f.length; i++) {
      if (f[i].contentWindow === e.source && f[i].src.indexOf(o + "/embed/") === 0) {
        f[i].style.height = Math.ceil(h) + "px";
        return;
      }
    }
  });
})();
