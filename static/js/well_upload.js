(function () {
  const form = document.getElementById("well-form");
  if (!form) return;

  const hatchInput = document.getElementById("hatch-input");
  const panInput = document.getElementById("panorama-input");
  const hatchHint = document.getElementById("hatch-gps-hint");
  const panHint = document.getElementById("pan-gps-hint");
  const submitBtn = document.getElementById("submit-btn");
  const clientError = document.getElementById("client-error");

  let hatchOk = false;
  let panOk = false;

  const hatchMap = L.map("map-hatch", { zoomControl: true }).setView([55.75, 37.62], 12);
  const panMap = L.map("map-panorama", { zoomControl: true }).setView([55.75, 37.62], 12);

  const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  });
  tiles.addTo(hatchMap);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(panMap);

  let hatchMarker = null;
  let panMarker = null;

  function invalidateMaps() {
    setTimeout(function () {
      hatchMap.invalidateSize();
      panMap.invalidateSize();
    }, 200);
  }
  window.addEventListener("load", invalidateMaps);

  async function readGps(file) {
    if (!file || !window.exifr) return null;
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
        return { lat: gps.latitude, lon: gps.longitude };
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

  async function onHatchChange() {
    hatchOk = false;
    const f = hatchInput.files && hatchInput.files[0];
    if (!f) {
      hatchHint.textContent = "Выберите файл — проверим GPS в браузере.";
      hatchHint.classList.remove("ok", "bad");
      if (hatchMarker) {
        hatchMap.removeLayer(hatchMarker);
        hatchMarker = null;
      }
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
      if (hatchMarker) {
        hatchMap.removeLayer(hatchMarker);
        hatchMarker = null;
      }
      updateSubmit();
      return;
    }
    hatchOk = true;
    setHint(hatchHint, true, "GPS в EXIF найден.", "");
    hatchMap.setView([pos.lat, pos.lon], 17);
    if (hatchMarker) hatchMap.removeLayer(hatchMarker);
    hatchMarker = L.marker([pos.lat, pos.lon]).addTo(hatchMap);
    invalidateMaps();
    updateSubmit();
  }

  async function onPanChange() {
    panOk = false;
    const f = panInput.files && panInput.files[0];
    if (!f) {
      panHint.textContent = "Выберите файл — проверим GPS в браузере.";
      panHint.classList.remove("ok", "bad");
      if (panMarker) {
        panMap.removeLayer(panMarker);
        panMarker = null;
      }
      updateSubmit();
      return;
    }
    const pos = await readGps(f);
    if (!pos) {
      setHint(
        panHint,
        false,
        "",
        "В этом файле не найдены GPS-координаты в EXIF."
      );
      if (panMarker) {
        panMap.removeLayer(panMarker);
        panMarker = null;
      }
      updateSubmit();
      return;
    }
    panOk = true;
    setHint(panHint, true, "GPS в EXIF найден.", "");
    panMap.setView([pos.lat, pos.lon], 16);
    if (panMarker) panMap.removeLayer(panMarker);
    panMarker = L.marker([pos.lat, pos.lon]).addTo(panMap);
    invalidateMaps();
    updateSubmit();
  }

  function updateSubmit() {
    submitBtn.disabled = !(hatchOk && panOk);
    clientError.hidden = true;
  }

  hatchInput.addEventListener("change", onHatchChange);
  panInput.addEventListener("change", onPanChange);

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
        hatchHint.textContent = "Выберите файл — проверим GPS в браузере.";
        panHint.textContent = "Выберите файл — проверим GPS в браузере.";
        hatchHint.classList.remove("ok", "bad");
        panHint.classList.remove("ok", "bad");
        if (hatchMarker) {
          hatchMap.removeLayer(hatchMarker);
          hatchMarker = null;
        }
        if (panMarker) {
          panMap.removeLayer(panMarker);
          panMarker = null;
        }
        hatchMap.setView([55.75, 37.62], 12);
        panMap.setView([55.75, 37.62], 12);
        if (nextBlock) {
          nextBlock.scrollIntoView({ behavior: "smooth", block: "start" });
        }
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
