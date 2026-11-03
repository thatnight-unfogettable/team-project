/* ============================================================
   凉径 ShadeRoute Lite —— 坐标投影
   责任：jiang（与 map.js 共用）
   数据里所有坐标都是"相对 bbox 中心的米坐标"（x=东, y=北）。
   ============================================================ */

window.PROJ = (function () {
  var meta = window.DATA_META || {};
  var bbox = meta.bbox_m || [-600, -500, 600, 500];   // [minX, minY, maxX, maxY] 米
  var originLatLon = meta.origin || [0, 0];

  var M_PER_DEG_LAT = 110540.0;
  var M_PER_DEG_LON = 111320.0 * Math.cos(originLatLon[0] * Math.PI / 180);

  return {
    bbox: bbox,
    origin: originLatLon,

    width: function () { return bbox[2] - bbox[0]; },
    height: function () { return bbox[3] - bbox[1]; },

    /* 米坐标 -> 经纬度（做"现场报地址"功能时用） */
    toLatLon: function (x, y) {
      return [
        originLatLon[0] + y / M_PER_DEG_LAT,
        originLatLon[1] + x / M_PER_DEG_LON
      ];
    },

    /* 经纬度 -> 米坐标 */
    toXY: function (lat, lon) {
      return [
        (lon - originLatLon[1]) * M_PER_DEG_LON,
        (lat - originLatLon[0]) * M_PER_DEG_LAT
      ];
    },

    /* 计算"米 -> 屏幕像素"的适配变换（保持等比，居中，留边距）
       实现放在 js/core.js，这里只做"本项目 bbox"的绑定，方便 Node 单测。 */
    fit: function (cssWidth, cssHeight, pad) {
      return window.CORE.fitTransform(bbox, cssWidth, cssHeight, pad);
    }
  };
})();