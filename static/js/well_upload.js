(function () {
  const form = document.getElementById("well-form");
  if (!form) return;

  const hatchInput = document.getElementById("hatch-input");
  const panInput = document.getElementById("panorama-input");
  const hatchHint = document.getElementById("hatch-gps-hint");
  const panHint = document.getElementById("pan-gps-hint");
  const submitBtn = document.getElementById("submit-btn");
  const clientError = document.getElementById("client-error");
  const geoStatus = document.getElementById("geo-status");
  const submitHint = document.getElementById("submit-hint");

  const DEFAULT_CENTER = [55.75, 37.62];
  const DEFAULT_ZOOM = 11;

  let hatchOk = false;
  let panOk = false;
  let hatchFromMap = false;
  let panFromMap = false;
  let hatchLoadGen = 0;
  let panLoadGen = 0;
  /** Последняя геопозиция с карты (браузер) — уходит на сервер при отправке формы */
  let lastUserMap = null;

  async function recheckGpsAfterGeo() {
    await onHatchChange();
    await onPanChange();
  }

  function _fileKey(file) {
    return file ? file.name + "|" + file.size + "|" + file.lastModified : "";
  }

  const map = L.map("map-well", { zoomControl: true }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  let hatchMarker = null;
  let panMarker = null;
  let userMarker = null;
  let userAccuracyCircle = null;

  function removeHatchMarker() {
    if (hatchMarker) {
      map.removeLayer(hatchMarker);
      hatchMarker = null;
    }
  }

  function removePanMarker() {
    if (panMarker) {
      map.removeLayer(panMarker);
      panMarker = null;
    }
  }

  function removeUserGeo() {
    if (userMarker) {
      map.removeLayer(userMarker);
      userMarker = null;
    }
    if (userAccuracyCircle) {
      map.removeLayer(userAccuracyCircle);
      userAccuracyCircle = null;
    }
  }

  function fitMapToAll() {
    try {
      const layers = [];
      if (hatchMarker) layers.push(hatchMarker);
      if (panMarker) layers.push(panMarker);
      if (userMarker) layers.push(userMarker);
      if (userAccuracyCircle) layers.push(userAccuracyCircle);

      if (layers.length === 0) {
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        return;
      }

      const b = L.featureGroup(layers).getBounds();
      if (b.isValid()) {
        map.fitBounds(b, { padding: [56, 56], maxZoom: 17 });
      }
    } catch (e) {
      console.warn("fitMapToAll", e);
    }
  }

  function invalidateMap() {
    setTimeout(function () {
      map.invalidateSize();
    }, 200);
  }

  function requestBrowserGeo() {
    if (!geoStatus) return;
    geoStatus.textContent = "";
    if (!navigator.geolocation) {
      lastUserMap = null;
      geoStatus.textContent = "Геолокация в этом браузере недоступна.";
      void recheckGpsAfterGeo();
      return;
    }
    geoStatus.textContent = "Запрос местоположения у браузера…";
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const acc = pos.coords.accuracy;

        removeUserGeo();

        userAccuracyCircle = L.circle([lat, lon], {
          radius: Math.max(acc, 25),
          color: "#c9a227",
          weight: 1,
          fillColor: "#f5d76e",
          fillOpacity: 0.2,
        }).addTo(map);

        userMarker = L.circleMarker([lat, lon], {
          radius: 8,
          color: "#c9a227",
          weight: 2,
          fillColor: "#f5d76e",
          fillOpacity: 1,
        })
          .addTo(map)
          .bindPopup(
            "Ваше местоположение по данным браузера<br>точность ≈ " + Math.round(acc) + " м"
          );

        lastUserMap = { lat: lat, lon: lon, acc: acc };
        geoStatus.textContent = "Местоположение на карте (жёлтая точка).";
        fitMapToAll();
        invalidateMap();
        void recheckGpsAfterGeo();
      },
      function (err) {
        lastUserMap = null;
        const codes = {
          1: "Геолокация отклонена — без неё нельзя подставить координаты, если в EXIF нет GPS.",
          2: "Не удалось определить местоположение.",
          3: "Превышено время ожидания геолокации.",
        };
        geoStatus.textContent = codes[err.code] || "Геолокация недоступна.";
        void recheckGpsAfterGeo();
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
    );
  }

  window.addEventListener("load", function () {
    invalidateMap();
    setTimeout(requestBrowserGeo, 400);
  });

  function _numCoord(v) {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "") {
      const n = parseFloat(v.replace(",", "."));
      return Number.isFinite(n) ? n : NaN;
    }
    return NaN;
  }

  function _coordsFromObject(obj) {
    if (!obj || typeof obj !== "object") return null;
    const lat = _numCoord(
      obj.latitude ?? obj.Latitude ?? obj.GPSLatitude ?? obj.gpsLatitude
    );
    const lon = _numCoord(
      obj.longitude ?? obj.Longitude ?? obj.GPSLongitude ?? obj.gpsLongitude
    );
    if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
      return { lat: lat, lon: lon };
    }
    if (obj.GPS && typeof obj.GPS === "object") {
      return _coordsFromObject(obj.GPS);
    }
    return null;
  }

  /**
   * Чтение GPS из EXIF/XMP: ArrayBuffer + несколько стратегий и повторов.
   * Иначе на части устройств первый проход по File даёт пусто, хотя координаты в файле есть.
   */
  async function readGps(file) {
    const ex = typeof globalThis.exifr !== "undefined" ? globalThis.exifr : null;
    if (!file || !ex || !file.size) {
      return null;
    }
    await new Promise(function (r) {
      queueMicrotask(r);
    });
    let buffer;
    try {
      buffer = await file.arrayBuffer();
    } catch (e) {
      console.warn("readGps arrayBuffer", e);
      return null;
    }
    const tryParse = async function (opts) {
      try {
        return await ex.parse(buffer, opts);
      } catch (e) {
        console.warn("readGps parse", opts, e);
        return null;
      }
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        await new Promise(function (r) {
          setTimeout(r, 60 * attempt);
        });
      }
      try {
        if (typeof ex.gps === "function") {
          const g = await ex.gps(buffer);
          const c = _coordsFromObject(g);
          if (c) return c;
        }
      } catch (e) {
        console.warn("readGps gps()", e);
      }
      const strategies = [
        { gps: true, tiff: true, xmp: true, reviveValues: true, translateKeys: true },
        { gps: true, tiff: true, ifd0: true, exif: true, reviveValues: true },
        { gps: true, mergeOutput: true, reviveValues: true },
        { tiff: true, xmp: true, reviveValues: true },
      ];
      for (let s = 0; s < strategies.length; s++) {
        const parsed = await tryParse(strategies[s]);
        const c = _coordsFromObject(parsed);
        if (c) return c;
      }
    }
    return null;
  }

  function setHint(el, ok, okText, badText) {
    el.textContent = ok ? okText : badText;
    el.classList.remove("ok", "bad");
    el.classList.add(ok ? "ok" : "bad");
  }

  function updateSubmit() {
    if (submitBtn) {
      submitBtn.disabled = !(hatchOk && panOk);
    }
    clientError.hidden = true;
    if (submitHint) {
      if (hatchOk && panOk) {
        submitHint.textContent = "Оба снимка с координатами (EXIF и/или карта) — можно отправить на сервер.";
        submitHint.className = "small hint ok";
      } else {
        submitHint.textContent =
          "Нужны координаты для обоих файлов: GPS в EXIF или точка с карты после разрешения геолокации. Подсказки под полями и маркеры на карте покажут готовность.";
        submitHint.className = "small muted";
      }
    }
  }

  async function onHatchChange() {
    const gen = ++hatchLoadGen;
    hatchOk = false;
    hatchFromMap = false;
    removeHatchMarker();
    updateSubmit();
    const f = hatchInput.files && hatchInput.files[0];
    if (!f) {
      hatchHint.textContent = "Выберите файл — проверим GPS в EXIF или подставим точку с карты.";
      hatchHint.classList.remove("ok", "bad");
      fitMapToAll();
      updateSubmit();
      return;
    }
    const key = _fileKey(f);
    const pos = await readGps(f);
    if (gen !== hatchLoadGen) return;
    if (_fileKey(hatchInput.files && hatchInput.files[0]) !== key) return;
    let useLat;
    let useLon;
    let fromMap = false;
    if (pos) {
      useLat = pos.lat;
      useLon = pos.lon;
      fromMap = false;
    } else if (lastUserMap && Number.isFinite(lastUserMap.lat) && Number.isFinite(lastUserMap.lon)) {
      useLat = lastUserMap.lat;
      useLon = lastUserMap.lon;
      fromMap = true;
    } else {
      setHint(
        hatchHint,
        false,
        "",
        "В EXIF нет GPS. Разрешите геолокацию (жёлтая точка на карте) или выберите фото с геометкой."
      );
      fitMapToAll();
      updateSubmit();
      return;
    }
    hatchOk = true;
    hatchFromMap = fromMap;
    if (fromMap) {
      setHint(hatchHint, true, "В EXIF нет GPS — для люка используем координаты с карты (браузер), синяя точка.", "");
    } else {
      setHint(hatchHint, true, "GPS в EXIF найден — точка на карте (синяя).", "");
    }
    try {
      hatchMarker = L.circleMarker([useLat, useLon], {
        radius: 10,
        color: "#2a7abf",
        weight: 2,
        fillColor: "#3d9cf5",
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(fromMap ? "Люк: координаты с карты (EXIF без GPS)" : "Люк: координаты из EXIF этого фото");
      fitMapToAll();
      invalidateMap();
    } catch (e) {
      console.warn("onHatchChange map", e);
    } finally {
      updateSubmit();
    }
  }

  async function onPanChange() {
    const gen = ++panLoadGen;
    panOk = false;
    panFromMap = false;
    removePanMarker();
    updateSubmit();
    const f = panInput.files && panInput.files[0];
    if (!f) {
      panHint.textContent = "Выберите файл — проверим GPS в EXIF или подставим точку с карты.";
      panHint.classList.remove("ok", "bad");
      fitMapToAll();
      updateSubmit();
      return;
    }
    const key = _fileKey(f);
    const pos = await readGps(f);
    if (gen !== panLoadGen) return;
    if (_fileKey(panInput.files && panInput.files[0]) !== key) return;
    let useLat;
    let useLon;
    let fromMap = false;
    if (pos) {
      useLat = pos.lat;
      useLon = pos.lon;
      fromMap = false;
    } else if (lastUserMap && Number.isFinite(lastUserMap.lat) && Number.isFinite(lastUserMap.lon)) {
      useLat = lastUserMap.lat;
      useLon = lastUserMap.lon;
      fromMap = true;
    } else {
      setHint(
        panHint,
        false,
        "",
        "В EXIF нет GPS. Разрешите геолокацию (жёлтая точка) или выберите фото с геометкой."
      );
      fitMapToAll();
      updateSubmit();
      return;
    }
    panOk = true;
    panFromMap = fromMap;
    if (fromMap) {
      setHint(panHint, true, "В EXIF нет GPS — для панорамы используем координаты с карты (браузер), зелёная точка.", "");
    } else {
      setHint(panHint, true, "GPS в EXIF найден — точка на карте (зелёная).", "");
    }
    try {
      panMarker = L.circleMarker([useLat, useLon], {
        radius: 10,
        color: "#2d8a4e",
        weight: 2,
        fillColor: "#4ecf7a",
        fillOpacity: 0.95,
      })
        .addTo(map)
        .bindPopup(fromMap ? "Панорама: координаты с карты (EXIF без GPS)" : "Панорама: координаты из EXIF этого фото");
      fitMapToAll();
      invalidateMap();
    } catch (e) {
      console.warn("onPanChange map", e);
    } finally {
      updateSubmit();
    }
  }

  function bindFileInput(el, handler) {
    el.addEventListener("change", handler);
    el.addEventListener("input", handler);
  }

  bindFileInput(hatchInput, onHatchChange);
  bindFileInput(panInput, onPanChange);

  if (typeof globalThis.exifr === "undefined" && submitHint) {
    submitHint.textContent =
      "Библиотека EXIF не загрузилась — в файлах не проверить GPS. Координаты можно подставить с карты после разрешения геолокации (если она доступна).";
    submitHint.className = "small hint bad";
  } else {
    updateSubmit();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clientError.hidden = true;
    if (!hatchOk || !panOk) {
      clientError.textContent = "Сначала выберите оба файла и дождитесь координат (EXIF или карта).";
      clientError.hidden = false;
      return;
    }
    const fd = new FormData();
    fd.append("hatch", hatchInput.files[0]);
    fd.append("panorama", panInput.files[0]);
    if (lastUserMap != null) {
      fd.append("user_map_lat", String(lastUserMap.lat));
      fd.append("user_map_lon", String(lastUserMap.lon));
      if (typeof lastUserMap.acc === "number" && isFinite(lastUserMap.acc)) {
        fd.append("user_map_accuracy_m", String(lastUserMap.acc));
      }
    }
    if (hatchFromMap) {
      fd.append("hatch_from_map", "1");
    }
    if (panFromMap) {
      fd.append("panorama_from_map", "1");
    }
    if (submitBtn) submitBtn.disabled = true;
    try {
      const res = await fetch("/api/well", {
        method: "POST",
        body: fd,
        credentials: "same-origin",
        headers: { Accept: "text/html" },
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && ct.includes("text/html")) {
        const html = await res.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const nextBlock = doc.getElementById("rating-block");
        const cur = document.getElementById("rating-block");
        if (nextBlock && cur) {
          cur.replaceWith(nextBlock);
        }
        form.reset();
        hatchOk = false;
        panOk = false;
        hatchFromMap = false;
        panFromMap = false;
        hatchHint.textContent = "Выберите файл — проверим GPS в EXIF или подставим точку с карты.";
        panHint.textContent = "Выберите файл — проверим GPS в EXIF или подставим точку с карты.";
        hatchHint.classList.remove("ok", "bad");
        panHint.classList.remove("ok", "bad");
        removeHatchMarker();
        removePanMarker();
        removeUserGeo();
        lastUserMap = null;
        if (geoStatus) geoStatus.textContent = "";
        map.setView(DEFAULT_CENTER, DEFAULT_ZOOM);
        if (nextBlock) {
          nextBlock.scrollIntoView({ behavior: "smooth", block: "start" });
        }
        setTimeout(requestBrowserGeo, 400);
      } else {
        let msg = "Не удалось сохранить.";
        try {
          const data = await res.json();
          if (data && data.detail) {
            msg = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
          }
        } catch {
          msg = res.statusText || msg;
        }
        clientError.textContent = msg;
        clientError.hidden = false;
      }
    } catch (err) {
      clientError.textContent = "Ошибка сети. Попробуйте ещё раз.";
      clientError.hidden = false;
    } finally {
      if (submitBtn) submitBtn.disabled = !(hatchOk && panOk);
    }
  });
})();
