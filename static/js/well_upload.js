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
  /** Последняя геопозиция с карты (браузер) — уходит на сервер при отправке формы */
  let lastUserMap = null;

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
      },
      function (err) {
        lastUserMap = null;
        const codes = {
          1: "Геолокация отклонена — карта только по EXIF фото.",
          2: "Не удалось определить местоположение.",
          3: "Превышено время ожидания геолокации.",
        };
        geoStatus.textContent = codes[err.code] || "Геолокация недоступна.";
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

  async function readGps(file) {
    const ex = typeof globalThis.exifr !== "undefined" ? globalThis.exifr : null;
    if (!file || !ex) {
      return null;
    }
    try {
      let lat = NaN;
      let lon = NaN;
      if (typeof ex.gps === "function") {
        const gps = await ex.gps(file);
        if (gps) {
          lat = _numCoord(gps.latitude);
          lon = _numCoord(gps.longitude);
        }
      }
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        const parsed = await ex.parse(file, { gps: true });
        if (parsed) {
          lat = _numCoord(parsed.latitude ?? parsed.GPSLatitude);
          lon = _numCoord(parsed.longitude ?? parsed.GPSLongitude);
        }
      }
      if (Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat: lat, lon: lon };
      }
    } catch (e) {
      console.warn(e);
    }
    return null;
  }

  function setHint(el, ok, okText, badText) {
    el.textContent = ok ? okText : badText;
    el.classList.remove("ok", "bad");
    el.classList.add(ok ? "ok" : "bad");
  }

  function updateSubmit() {
    submitBtn.disabled = !(hatchOk && panOk);
    clientError.hidden = true;
    if (submitHint) {
      if (hatchOk && panOk) {
        submitHint.textContent = "Оба снимка с GPS — можно отправить на сервер.";
        submitHint.className = "small hint ok";
      } else {
        submitHint.textContent =
          "Кнопка включится, когда в обоих файлах будет распознан GPS в EXIF (зелёные подсказки и точки на карте). Снимки с телефона обычно подходят, если при съёмке была включена геолокация.";
        submitHint.className = "small muted";
      }
    }
  }

  async function onHatchChange() {
    hatchOk = false;
    removeHatchMarker();
    const f = hatchInput.files && hatchInput.files[0];
    if (!f) {
      hatchHint.textContent = "Выберите файл — проверим GPS в EXIF.";
      hatchHint.classList.remove("ok", "bad");
      fitMapToAll();
      updateSubmit();
      return;
    }
    const pos = await readGps(f);
    if (!pos) {
      setHint(
        hatchHint,
        false,
        "",
        "В этом файле не найдены GPS-координаты в EXIF. Снимок с телефона с включённой геолокацией обычно подходит."
      );
      fitMapToAll();
      updateSubmit();
      return;
    }
    hatchOk = true;
    setHint(hatchHint, true, "GPS в EXIF найден — точка на карте (синяя).", "");
    hatchMarker = L.circleMarker([pos.lat, pos.lon], {
      radius: 10,
      color: "#2a7abf",
      weight: 2,
      fillColor: "#3d9cf5",
      fillOpacity: 0.95,
    })
      .addTo(map)
      .bindPopup("Люк: координаты из EXIF этого фото");
    fitMapToAll();
    invalidateMap();
    updateSubmit();
  }

  async function onPanChange() {
    panOk = false;
    removePanMarker();
    const f = panInput.files && panInput.files[0];
    if (!f) {
      panHint.textContent = "Выберите файл — проверим GPS в EXIF.";
      panHint.classList.remove("ok", "bad");
      fitMapToAll();
      updateSubmit();
      return;
    }
    const pos = await readGps(f);
    if (!pos) {
      setHint(panHint, false, "", "В этом файле не найдены GPS-координаты в EXIF.");
      fitMapToAll();
      updateSubmit();
      return;
    }
    panOk = true;
    setHint(panHint, true, "GPS в EXIF найден — точка на карте (зелёная).", "");
    panMarker = L.circleMarker([pos.lat, pos.lon], {
      radius: 10,
      color: "#2d8a4e",
      weight: 2,
      fillColor: "#4ecf7a",
      fillOpacity: 0.95,
    })
      .addTo(map)
      .bindPopup("Панорама: координаты из EXIF этого фото");
    fitMapToAll();
    invalidateMap();
    updateSubmit();
  }

  hatchInput.addEventListener("change", onHatchChange);
  panInput.addEventListener("change", onPanChange);

  if (typeof globalThis.exifr === "undefined" && submitHint) {
    submitHint.textContent =
      "Не загрузилась библиотека EXIF (cdn.jsdelivr.net). Проверьте сеть, VPN или блокировщик — без неё GPS в файлах не проверить и кнопка не активируется.";
    submitHint.className = "small hint bad";
  } else {
    updateSubmit();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    clientError.hidden = true;
    if (!hatchOk || !panOk) {
      clientError.textContent = "Сначала выберите два снимка с GPS в EXIF.";
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
    submitBtn.disabled = true;
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
        hatchHint.textContent = "Выберите файл — проверим GPS в EXIF.";
        panHint.textContent = "Выберите файл — проверим GPS в EXIF.";
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
      submitBtn.disabled = !(hatchOk && panOk);
    }
  });
})();
