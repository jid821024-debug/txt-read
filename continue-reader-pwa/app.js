(() => {
  "use strict";

  const MAX_FILE_SIZE = 20 * 1024 * 1024;
  const MAX_BLOCK_LENGTH = 1200;
  const PROGRESS_SAVE_DELAY = 1100;
  const PROGRESS_INTERVAL = 15000;
  const SETTINGS_KEY = "continue-reader-settings";
  const DEVICE_KEY = "continue-reader-device-id";
  const DB_NAME = "continue-reader-offline";
  const DB_VERSION = 1;

  const $ = (id) => document.getElementById(id);
  const screens = ["config-screen", "login-screen", "library-screen", "reader-screen"];

  const state = {
    client: null,
    session: null,
    user: null,
    documents: [],
    currentDocument: null,
    blocks: [],
    progress: null,
    settings: null,
    progressTimer: null,
    settingsTimer: null,
    progressInterval: null,
    restoring: false,
    search: { term: "", matches: [], index: -1 },
    wakeLock: null,
    layoutTimer: null,
    pendingLayoutPosition: null,
    installPrompt: null,
    toastTimer: null,
  };

  const defaultSettings = {
    font_size: 20,
    line_height: 1.8,
    content_width: 760,
    theme: "system",
    screen_wake_lock: false,
  };

  function showScreen(id) {
    for (const screen of screens) $(screen).classList.toggle("hidden", screen !== id);
  }

  function setBusy(button, busy, busyLabel, normalLabel) {
    button.disabled = busy;
    button.textContent = busy ? busyLabel : normalLabel;
  }

  function showToast(message, duration = 2600) {
    const toast = $("toast");
    toast.textContent = message;
    toast.classList.remove("hidden");
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.add("hidden"), duration);
  }

  function formatDate(value) {
    if (!value) return "기록 없음";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "기록 없음";
    return new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function isConfigured() {
    const cfg = window.APP_CONFIG || {};
    return Boolean(
      cfg.SUPABASE_URL &&
      cfg.SUPABASE_ANON_KEY &&
      !cfg.SUPABASE_URL.includes("프로젝트") &&
      !cfg.SUPABASE_ANON_KEY.includes("입력")
    );
  }

  function initClient() {
    if (!isConfigured()) {
      showScreen("config-screen");
      return false;
    }
    if (!window.supabase?.createClient) {
      showScreen("config-screen");
      $("config-title").textContent = "Supabase 모듈을 불러오지 못했습니다";
      $("config-screen").querySelector("p").textContent = "인터넷 연결을 확인한 뒤 새로고침해 주세요.";
      return false;
    }
    const cfg = window.APP_CONFIG;
    state.client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
    return true;
  }

  async function initAuth() {
    const { data, error } = await state.client.auth.getSession();
    if (error) console.warn("세션 확인 실패", error);
    state.session = data?.session || null;
    state.user = state.session?.user || null;

    state.client.auth.onAuthStateChange((_event, session) => {
      state.session = session;
      state.user = session?.user || null;
      if (!session) {
        cleanupReader();
        location.hash = "#/login";
      }
    });

    route();
  }

  async function login(event) {
    event.preventDefault();
    const email = $("login-email").value.trim();
    const password = $("login-password").value;
    const button = $("login-button");
    $("login-error").textContent = "";
    setBusy(button, true, "로그인 중", "로그인");

    const { data, error } = await state.client.auth.signInWithPassword({ email, password });
    setBusy(button, false, "로그인 중", "로그인");
    if (error) {
      $("login-error").textContent = translateAuthError(error.message);
      return;
    }
    state.session = data.session;
    state.user = data.user;
    location.hash = "#/library";
  }

  function translateAuthError(message) {
    const text = String(message || "").toLowerCase();
    if (text.includes("invalid login")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
    if (text.includes("email not confirmed")) return "Supabase에서 이메일 확인 처리가 필요합니다.";
    return `로그인할 수 없습니다: ${message}`;
  }

  async function logout() {
    await saveProgress(true);
    await state.client.auth.signOut();
    location.hash = "#/login";
  }

  async function ensureSession() {
    if (state.session && state.user) return true;
    const { data } = await state.client.auth.getSession();
    state.session = data?.session || null;
    state.user = state.session?.user || null;
    return Boolean(state.session);
  }

  async function route() {
    const hash = location.hash || "#/library";
    if (!state.client) return;
    const loggedIn = await ensureSession();

    if (!loggedIn) {
      if (hash !== "#/login") location.hash = "#/login";
      showScreen("login-screen");
      return;
    }

    if (hash.startsWith("#/reader/")) {
      const documentId = hash.slice("#/reader/".length);
      if (!documentId) {
        location.hash = "#/library";
        return;
      }
      showScreen("reader-screen");
      await openReader(documentId);
      return;
    }

    showScreen("library-screen");
    $("account-label").textContent = state.user?.email || "";
    await loadLibrary();
  }

  async function loadLibrary() {
    cleanupReader();
    $("document-list").innerHTML = "";
    $("document-count").textContent = "불러오는 중";

    let documents = [];
    let progressRows = [];
    let onlineLoaded = false;

    if (navigator.onLine) {
      const [docResult, progressResult] = await Promise.all([
        state.client.from("documents").select("*").order("updated_at", { ascending: false }),
        state.client.from("reading_progress").select("*"),
      ]);
      if (!docResult.error) {
        documents = docResult.data || [];
        progressRows = progressResult.error ? [] : progressResult.data || [];
        onlineLoaded = true;
      } else {
        console.warn("서재 불러오기 실패", docResult.error);
      }
    }

    if (!onlineLoaded) {
      const cached = await idbGetAll("documents");
      documents = cached.map((entry) => entry.document).filter(Boolean);
      progressRows = documents.map((doc) => getLocalProgress(doc.id)).filter(Boolean);
      if (!documents.length && !navigator.onLine) showToast("오프라인입니다. 캐시된 문서가 없습니다.");
    }

    const progressMap = new Map(progressRows.map((row) => [row.document_id, row]));
    state.documents = documents;
    renderLibrary(documents, progressMap);
  }

  function renderLibrary(documents, progressMap) {
    const list = $("document-list");
    list.innerHTML = "";
    $("document-count").textContent = `${documents.length}개`;
    $("empty-library").classList.toggle("hidden", documents.length > 0);

    for (const doc of documents) {
      const remoteProgress = progressMap.get(doc.id);
      const localProgress = getLocalProgress(doc.id);
      const progress = newerProgress(remoteProgress, localProgress);
      const percent = clamp(Number(progress?.progress_percent || 0), 0, 100);

      const card = document.createElement("article");
      card.className = "document-card";

      const title = document.createElement("h3");
      title.textContent = doc.title;

      const meta = document.createElement("div");
      meta.className = "document-meta";
      meta.innerHTML = `
        <span>${escapeHtml(doc.original_filename || "TXT 문서")}</span>
        <span>${Number(doc.total_characters || 0).toLocaleString()}자 · ${Number(doc.total_blocks || 0).toLocaleString()}문단</span>
        <span>최근 읽음 ${formatDate(progress?.updated_at || progress?.updatedAt)}</span>
      `;

      const progressTrack = document.createElement("div");
      progressTrack.className = "card-progress";
      const fill = document.createElement("div");
      fill.style.width = `${percent}%`;
      progressTrack.append(fill);

      const percentLabel = document.createElement("strong");
      percentLabel.textContent = `진행률 ${percent.toFixed(percent >= 10 ? 0 : 1)}%`;

      const actions = document.createElement("div");
      actions.className = "card-actions";
      const readButton = document.createElement("button");
      readButton.type = "button";
      readButton.className = "primary-button";
      readButton.textContent = percent > 0 ? "이어 읽기" : "읽기";
      readButton.addEventListener("click", () => { location.hash = `#/reader/${doc.id}`; });

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger-button";
      deleteButton.textContent = "삭제";
      deleteButton.addEventListener("click", () => deleteDocument(doc));

      actions.append(readButton, deleteButton);
      card.append(title, meta, progressTrack, percentLabel, actions);
      list.append(card);
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  async function deleteDocument(doc) {
    if (!confirm(`“${doc.title}” 문서를 삭제하시겠습니까?\n읽기 기록도 함께 삭제됩니다.`)) return;
    if (!navigator.onLine) {
      showToast("문서 삭제는 인터넷에 연결된 상태에서 가능합니다.");
      return;
    }
    const { error } = await state.client.from("documents").delete().eq("id", doc.id);
    if (error) {
      showToast(`삭제하지 못했습니다: ${error.message}`);
      return;
    }
    localStorage.removeItem(progressKey(doc.id));
    await idbDelete("documents", doc.id);
    showToast("문서를 삭제했습니다.");
    await loadLibrary();
  }

  async function uploadDocument(event) {
    event.preventDefault();
    const file = $("file-input").files?.[0];
    const button = $("upload-button");
    const status = $("upload-status");

    if (!file) {
      status.textContent = "TXT 파일을 선택해 주세요.";
      return;
    }
    if (!navigator.onLine) {
      status.textContent = "문서 등록은 인터넷에 연결된 상태에서 가능합니다.";
      return;
    }
    if (!/\.txt$/i.test(file.name)) {
      status.textContent = "확장자가 .txt인 파일만 등록할 수 있습니다.";
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      status.textContent = `파일 크기는 ${formatBytes(MAX_FILE_SIZE)} 이하만 가능합니다.`;
      return;
    }

    setBusy(button, true, "처리 중", "등록");
    status.textContent = "파일을 읽는 중입니다.";
    let insertedDocumentId = null;

    try {
      const buffer = await file.arrayBuffer();
      const { text, encoding } = decodeText(buffer, $("encoding-select").value);
      const normalized = normalizeText(text);
      if (!normalized.trim()) throw new Error("내용이 없는 TXT 파일입니다.");

      status.textContent = "문서를 분석하는 중입니다.";
      const hash = await sha256(normalized);
      const { data: duplicate } = await state.client
        .from("documents")
        .select("id,title")
        .eq("content_hash", hash)
        .maybeSingle();
      if (duplicate) throw new Error(`같은 내용의 문서가 이미 등록되어 있습니다: ${duplicate.title}`);

      const blocks = splitIntoBlocks(normalized, MAX_BLOCK_LENGTH);
      const title = $("title-input").value.trim() || file.name.replace(/\.txt$/i, "") || "제목 없는 문서";
      const totalCharacters = blocks.reduce((sum, block) => sum + block.content.length, 0);

      const { data: inserted, error: documentError } = await state.client
        .from("documents")
        .insert({
          user_id: state.user.id,
          title,
          original_filename: file.name,
          encoding,
          content_hash: hash,
          file_size: file.size,
          total_characters: totalCharacters,
          total_blocks: blocks.length,
        })
        .select()
        .single();
      if (documentError) throw documentError;
      insertedDocumentId = inserted.id;

      let charStart = 0;
      const rows = blocks.map((block, index) => {
        const row = {
          document_id: inserted.id,
          user_id: state.user.id,
          block_index: index,
          char_start: charStart,
          content: block.content,
        };
        charStart += block.content.length;
        return row;
      });

      for (let start = 0; start < rows.length; start += 150) {
        const end = Math.min(start + 150, rows.length);
        status.textContent = `문단 저장 중 ${end.toLocaleString()} / ${rows.length.toLocaleString()}`;
        const { error } = await state.client.from("document_blocks").insert(rows.slice(start, end));
        if (error) throw error;
      }

      await idbPut("documents", { id: inserted.id, document: inserted, blocks: rows, cachedAt: new Date().toISOString() });
      await pruneDocumentCache();
      status.textContent = `등록 완료: ${blocks.length.toLocaleString()}개 문단`;
      $("upload-form").reset();
      $("file-name-label").textContent = "TXT 파일 선택";
      showToast("TXT 문서를 등록했습니다.");
      await loadLibrary();
    } catch (error) {
      console.error(error);
      if (insertedDocumentId) await state.client.from("documents").delete().eq("id", insertedDocumentId);
      status.textContent = error?.message || "문서를 등록하지 못했습니다.";
    } finally {
      setBusy(button, false, "처리 중", "등록");
    }
  }

  function decodeText(buffer, selectedEncoding) {
    const bytes = new Uint8Array(buffer);
    let encoding = selectedEncoding;

    if (selectedEncoding === "auto") {
      if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
        encoding = "utf-8";
      } else {
        try {
          const utf8 = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
          return { text: utf8, encoding: "utf-8" };
        } catch {
          encoding = "euc-kr";
        }
      }
    }

    try {
      const text = new TextDecoder(encoding === "euc-kr" ? "euc-kr" : "utf-8").decode(bytes);
      return { text, encoding };
    } catch {
      throw new Error("이 파일의 문자 인코딩을 읽을 수 없습니다. 인코딩을 직접 선택해 주세요.");
    }
  }

  function normalizeText(text) {
    return String(text)
      .replace(/^\uFEFF/, "")
      .replace(/\u0000/g, "")
      .replace(/\r\n?/g, "\n")
      .replace(/[\t ]+$/gm, "")
      .replace(/\n{4,}/g, "\n\n\n")
      .trim();
  }

  function splitIntoBlocks(text, maxLength) {
    const paragraphs = text.split(/\n{2,}/);
    const blocks = [];
    for (const paragraph of paragraphs) {
      const clean = paragraph.trim();
      if (!clean) continue;
      if (clean.length <= maxLength) {
        blocks.push({ content: clean });
        continue;
      }
      let rest = clean;
      while (rest.length > maxLength) {
        let cut = findSplitPoint(rest, maxLength);
        if (cut < Math.floor(maxLength * 0.45)) cut = maxLength;
        blocks.push({ content: rest.slice(0, cut).trimEnd() });
        rest = rest.slice(cut).replace(/^\s+/, "");
      }
      if (rest) blocks.push({ content: rest });
    }
    return blocks.length ? blocks : [{ content: text }];
  }

  function findSplitPoint(text, maxLength) {
    const candidates = [
      text.lastIndexOf("\n", maxLength),
      text.lastIndexOf(". ", maxLength),
      text.lastIndexOf("다. ", maxLength),
      text.lastIndexOf("요. ", maxLength),
      text.lastIndexOf(" ", maxLength),
    ];
    return Math.max(...candidates.map((value) => (value >= 0 ? value + 1 : -1)));
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function openReader(documentId) {
    if (state.currentDocument?.id === documentId && state.blocks.length) return;
    cleanupReader();
    state.currentDocument = { id: documentId };
    $("reader-content").innerHTML = "";
    $("reader-loading").classList.remove("hidden");
    $("reader-title").textContent = "문서 불러오는 중";
    updateSyncState();

    let documentRow = null;
    let blocks = null;

    if (navigator.onLine) {
      const [documentResult, blocksResult] = await Promise.all([
        state.client.from("documents").select("*").eq("id", documentId).single(),
        state.client.from("document_blocks").select("block_index,char_start,content").eq("document_id", documentId).order("block_index"),
      ]);
      if (!documentResult.error && !blocksResult.error) {
        documentRow = documentResult.data;
        blocks = blocksResult.data || [];
        await idbPut("documents", { id: documentId, document: documentRow, blocks, cachedAt: new Date().toISOString() });
        await pruneDocumentCache();
      } else {
        console.warn("온라인 문서 불러오기 실패", documentResult.error || blocksResult.error);
      }
    }

    if (!documentRow || !blocks) {
      const cached = await idbGet("documents", documentId);
      documentRow = cached?.document || null;
      blocks = cached?.blocks || null;
    }

    if (!documentRow || !blocks?.length) {
      $("reader-loading").textContent = navigator.onLine
        ? "문서를 불러오지 못했습니다. 삭제되었거나 접근 권한이 없습니다."
        : "오프라인에서 사용할 수 있도록 저장된 문서가 아닙니다.";
      return;
    }

    state.currentDocument = documentRow;
    state.blocks = blocks;
    $("reader-title").textContent = documentRow.title;
    renderReaderBlocks(blocks);
    $("reader-loading").classList.add("hidden");

    await loadSettings();
    const progress = await loadBestProgress(documentId);
    state.progress = progress;
    await restoreProgress(progress);

    window.addEventListener("scroll", scheduleProgressSave, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    state.progressInterval = setInterval(() => saveProgress(false), PROGRESS_INTERVAL);
    updateSyncState();
    updateProgressDisplay(progress?.progress_percent || 0);
  }

  function renderReaderBlocks(blocks) {
    const fragment = document.createDocumentFragment();
    for (const block of blocks) {
      const p = document.createElement("p");
      p.id = `block-${block.block_index}`;
      p.className = "reader-block";
      p.dataset.blockIndex = String(block.block_index);
      p.textContent = block.content;
      fragment.append(p);
    }
    $("reader-content").replaceChildren(fragment);
  }

  async function loadBestProgress(documentId) {
    const local = getLocalProgress(documentId);
    let remote = null;
    if (navigator.onLine) {
      const { data, error } = await state.client
        .from("reading_progress")
        .select("*")
        .eq("document_id", documentId)
        .maybeSingle();
      if (!error) remote = data;
    }
    return newerProgress(remote, local) || {
      document_id: documentId,
      block_index: 0,
      character_offset: 0,
      progress_percent: 0,
      updated_at: new Date(0).toISOString(),
    };
  }

  function newerProgress(a, b) {
    if (!a) return b || null;
    if (!b) return a;
    const aTime = new Date(a.updated_at || a.updatedAt || 0).getTime();
    const bTime = new Date(b.updated_at || b.updatedAt || 0).getTime();
    return bTime > aTime ? b : a;
  }

  function progressKey(documentId) {
    return `continue-reader-progress:${documentId}`;
  }

  function getLocalProgress(documentId) {
    try {
      return JSON.parse(localStorage.getItem(progressKey(documentId)) || "null");
    } catch {
      return null;
    }
  }

  function setLocalProgress(progress) {
    localStorage.setItem(progressKey(progress.document_id), JSON.stringify(progress));
  }

  async function restoreProgress(progress) {
    state.restoring = true;
    await nextFrame();
    await nextFrame();

    const index = clamp(Number(progress?.block_index || 0), 0, Math.max(0, state.blocks.length - 1));
    const element = $(`block-${index}`);
    if (!element) {
      state.restoring = false;
      return;
    }

    element.scrollIntoView({ block: "start" });
    await nextFrame();
    const targetY = getReaderTopOffset();
    const offset = clamp(Number(progress?.character_offset || 0), 0, element.textContent.length);
    const node = element.firstChild;

    if (node?.nodeType === Node.TEXT_NODE && offset > 0) {
      try {
        const range = document.createRange();
        const end = Math.min(offset + 1, node.textContent.length);
        range.setStart(node, offset);
        range.setEnd(node, end);
        const rect = range.getBoundingClientRect();
        if (rect.height || rect.top) {
          window.scrollBy(0, rect.top - targetY);
        } else {
          const ratio = offset / Math.max(1, element.textContent.length);
          window.scrollBy(0, element.getBoundingClientRect().height * ratio - targetY);
        }
      } catch {
        const ratio = offset / Math.max(1, element.textContent.length);
        window.scrollBy(0, element.getBoundingClientRect().height * ratio - targetY);
      }
    } else {
      window.scrollBy(0, -targetY);
    }

    setTimeout(() => { state.restoring = false; }, 450);
  }

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  function getReaderTopOffset() {
    const toolbar = $("reader-toolbar").getBoundingClientRect();
    const search = $("reader-search-input").closest(".reader-searchbar").getBoundingClientRect();
    return Math.max(toolbar.bottom, search.bottom) + 12;
  }

  function scheduleProgressSave() {
    if (state.restoring || !state.currentDocument?.id) return;
    const position = getCurrentPosition();
    if (position) updateProgressDisplay(position.progress_percent);
    clearTimeout(state.progressTimer);
    state.progressTimer = setTimeout(() => saveProgress(false), PROGRESS_SAVE_DELAY);
  }

  function getCurrentPosition() {
    if (!state.blocks.length) return null;
    const contentRect = $("reader-content").getBoundingClientRect();
    const targetY = getReaderTopOffset();
    const xValues = [
      clamp(contentRect.left + 40, 8, innerWidth - 8),
      clamp(contentRect.left + contentRect.width / 2, 8, innerWidth - 8),
      clamp(contentRect.right - 40, 8, innerWidth - 8),
    ];

    for (const x of xValues) {
      const point = caretAtPoint(x, targetY);
      if (point) return buildPosition(point.block, point.offset);
    }

    const elements = [...document.querySelectorAll(".reader-block")];
    let element = elements.find((item) => item.getBoundingClientRect().bottom > targetY);
    if (!element) element = elements.at(-1);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const ratio = clamp((targetY - rect.top) / Math.max(1, rect.height), 0, 1);
    return buildPosition(element, Math.round(element.textContent.length * ratio));
  }

  function caretAtPoint(x, y) {
    let node = null;
    let offset = 0;
    if (document.caretPositionFromPoint) {
      const caret = document.caretPositionFromPoint(x, y);
      node = caret?.offsetNode || null;
      offset = caret?.offset || 0;
    } else if (document.caretRangeFromPoint) {
      const range = document.caretRangeFromPoint(x, y);
      node = range?.startContainer || null;
      offset = range?.startOffset || 0;
    }
    if (!node) return null;
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const block = element?.closest?.(".reader-block");
    if (!block) return null;
    if (node.nodeType !== Node.TEXT_NODE) {
      const rect = block.getBoundingClientRect();
      offset = Math.round(block.textContent.length * clamp((y - rect.top) / Math.max(1, rect.height), 0, 1));
    }
    return { block, offset };
  }

  function buildPosition(blockElement, characterOffset) {
    const blockIndex = Number(blockElement.dataset.blockIndex || 0);
    const block = state.blocks[blockIndex] || state.blocks.find((item) => Number(item.block_index) === blockIndex);
    const offset = clamp(Number(characterOffset || 0), 0, blockElement.textContent.length);
    const charStart = Number(block?.char_start || 0);
    const total = Math.max(1, Number(state.currentDocument.total_characters || 1));
    const progressPercent = clamp(((charStart + offset) / total) * 100, 0, 100);
    return {
      user_id: state.user.id,
      document_id: state.currentDocument.id,
      block_index: blockIndex,
      character_offset: offset,
      progress_percent: Number(progressPercent.toFixed(3)),
      device_id: getDeviceId(),
      updated_at: new Date().toISOString(),
    };
  }

  async function saveProgress(force) {
    if (!state.currentDocument?.id || state.restoring) return;
    const position = getCurrentPosition();
    if (!position) return;
    state.progress = position;
    setLocalProgress(position);
    updateProgressDisplay(position.progress_percent);

    if (!navigator.onLine) {
      updateSyncState("기기에 저장됨 · 오프라인");
      return;
    }

    if (!force && document.visibilityState === "hidden") return;
    updateSyncState("저장 중");
    const { data, error } = await state.client.from("reading_progress").upsert(position, {
      onConflict: "user_id,document_id",
    }).select().single();
    if (error) {
      console.warn("진행률 저장 실패", error);
      updateSyncState("기기에 저장됨 · 동기화 대기");
      return;
    }
    if (data) {
      state.progress = data;
      setLocalProgress(data);
    }
    updateSyncState(`동기화됨 ${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`);
  }

  function updateProgressDisplay(percent) {
    const value = clamp(Number(percent || 0), 0, 100);
    $("reader-progress-bar").style.width = `${value}%`;
    $("reader-progress-label").textContent = `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  }

  function updateSyncState(custom) {
    if (custom) {
      $("reader-sync-state").textContent = custom;
      return;
    }
    $("reader-sync-state").textContent = navigator.onLine ? "동기화 준비" : "오프라인";
  }

  function handleVisibilityChange() {
    if (document.visibilityState === "hidden") saveProgress(true);
    else if (state.settings?.screen_wake_lock) requestWakeLock();
  }

  function handlePageHide() {
    const position = getCurrentPosition();
    if (position) setLocalProgress(position);
  }

  function cleanupReader() {
    window.removeEventListener("scroll", scheduleProgressSave);
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    window.removeEventListener("pagehide", handlePageHide);
    clearTimeout(state.progressTimer);
    clearTimeout(state.settingsTimer);
    clearTimeout(state.layoutTimer);
    clearInterval(state.progressInterval);
    state.progressTimer = null;
    state.settingsTimer = null;
    state.layoutTimer = null;
    state.pendingLayoutPosition = null;
    state.progressInterval = null;
    releaseWakeLock();
    state.currentDocument = null;
    state.blocks = [];
    state.progress = null;
    state.search = { term: "", matches: [], index: -1 };
    delete document.body.dataset.readerTheme;
    $("reader-settings-panel").classList.add("hidden");
  }

  async function loadSettings() {
    let settings = null;
    if (navigator.onLine) {
      const { data, error } = await state.client.from("reader_settings").select("*").maybeSingle();
      if (!error) settings = data;
    }
    if (!settings) {
      try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null"); } catch { settings = null; }
    }
    state.settings = { ...defaultSettings, ...(settings || {}) };
    applySettings();
  }

  function applySettings() {
    const settings = state.settings || defaultSettings;
    document.documentElement.style.setProperty("--reader-font-size", `${settings.font_size}px`);
    document.documentElement.style.setProperty("--reader-line-height", String(settings.line_height));
    document.documentElement.style.setProperty("--reader-width", `${settings.content_width}px`);
    document.body.dataset.readerTheme = settings.theme;

    $("font-size-range").value = settings.font_size;
    $("font-size-value").textContent = `${settings.font_size}px`;
    $("line-height-range").value = settings.line_height;
    $("line-height-value").textContent = Number(settings.line_height).toFixed(2).replace(/0$/, "");
    $("content-width-select").value = String(settings.content_width);
    $("theme-select").value = settings.theme;
    $("wake-lock-toggle").checked = Boolean(settings.screen_wake_lock);

    if (settings.screen_wake_lock) requestWakeLock();
    else releaseWakeLock();
  }

  function changeSetting(key, value) {
    if (!state.settings) state.settings = { ...defaultSettings };
    const changesLayout = ["font_size", "line_height", "content_width"].includes(key);
    if (changesLayout && state.currentDocument?.id) {
      state.pendingLayoutPosition = getCurrentPosition() || state.progress;
      state.restoring = true;
    }

    state.settings[key] = value;
    applySettings();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    clearTimeout(state.settingsTimer);
    state.settingsTimer = setTimeout(saveSettings, 800);

    if (changesLayout && state.pendingLayoutPosition) {
      clearTimeout(state.layoutTimer);
      state.layoutTimer = setTimeout(async () => {
        const position = state.pendingLayoutPosition;
        state.pendingLayoutPosition = null;
        await restoreProgress(position);
        scheduleProgressSave();
      }, 160);
    }
  }

  async function saveSettings() {
    if (!state.settings || !state.user || !navigator.onLine) return;
    const row = {
      user_id: state.user.id,
      font_size: Number(state.settings.font_size),
      line_height: Number(state.settings.line_height),
      content_width: Number(state.settings.content_width),
      theme: state.settings.theme,
      screen_wake_lock: Boolean(state.settings.screen_wake_lock),
      updated_at: new Date().toISOString(),
    };
    const { error } = await state.client.from("reader_settings").upsert(row, { onConflict: "user_id" });
    if (error) console.warn("설정 저장 실패", error);
  }

  async function requestWakeLock() {
    if (!state.settings?.screen_wake_lock || !navigator.wakeLock || document.visibilityState !== "visible") return;
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => { state.wakeLock = null; });
    } catch (error) {
      console.warn("화면 켜기 실패", error);
    }
  }

  async function releaseWakeLock() {
    if (!state.wakeLock) return;
    try { await state.wakeLock.release(); } catch { /* noop */ }
    state.wakeLock = null;
  }

  function searchInDocument() {
    const term = $("reader-search-input").value.trim();
    if (!term) return;
    const lower = term.toLocaleLowerCase("ko-KR");

    if (state.search.term !== lower) {
      const matches = [];
      for (const block of state.blocks) {
        const content = block.content.toLocaleLowerCase("ko-KR");
        let start = 0;
        while (start < content.length && matches.length < 2000) {
          const index = content.indexOf(lower, start);
          if (index < 0) break;
          matches.push({ blockIndex: Number(block.block_index), offset: index });
          start = index + Math.max(1, lower.length);
        }
      }
      state.search = { term: lower, matches, index: -1 };
    }

    if (!state.search.matches.length) {
      showToast("검색 결과가 없습니다.");
      return;
    }

    state.search.index = (state.search.index + 1) % state.search.matches.length;
    const match = state.search.matches[state.search.index];
    const element = $(`block-${match.blockIndex}`);
    const node = element?.firstChild;
    if (!element || !node) return;

    element.scrollIntoView({ block: "center", behavior: "smooth" });
    try {
      const range = document.createRange();
      range.setStart(node, match.offset);
      range.setEnd(node, Math.min(match.offset + term.length, node.textContent.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch { /* noop */ }
    showToast(`${state.search.index + 1} / ${state.search.matches.length}`);
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {
      showToast("이 브라우저에서는 전체 화면을 사용할 수 없습니다.");
    }
  }

  async function handleOnline() {
    updateSyncState("인터넷 연결됨 · 동기화 중");
    await saveProgress(true);
    await saveSettings();
    showToast("인터넷에 다시 연결되었습니다.");
  }

  function handleOffline() {
    updateSyncState("기기에 저장됨 · 오프라인");
    showToast("오프라인 상태입니다. 읽기 위치는 기기에 저장됩니다.");
  }

  function bindEvents() {
    $("login-form").addEventListener("submit", login);
    $("logout-button").addEventListener("click", logout);
    $("upload-form").addEventListener("submit", uploadDocument);
    $("refresh-library-button").addEventListener("click", loadLibrary);
    $("file-input").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      $("file-name-label").textContent = file ? `${file.name} · ${formatBytes(file.size)}` : "TXT 파일 선택";
      if (file && !$("title-input").value) $("title-input").value = file.name.replace(/\.txt$/i, "");
    });

    $("back-button").addEventListener("click", async () => {
      await saveProgress(true);
      location.hash = "#/library";
    });
    $("reader-menu-button").addEventListener("click", () => $("reader-settings-panel").classList.toggle("hidden"));
    $("close-settings-button").addEventListener("click", () => $("reader-settings-panel").classList.add("hidden"));
    $("font-size-range").addEventListener("input", (event) => changeSetting("font_size", Number(event.target.value)));
    $("line-height-range").addEventListener("input", (event) => changeSetting("line_height", Number(event.target.value)));
    $("content-width-select").addEventListener("change", (event) => changeSetting("content_width", Number(event.target.value)));
    $("theme-select").addEventListener("change", (event) => changeSetting("theme", event.target.value));
    $("wake-lock-toggle").addEventListener("change", (event) => changeSetting("screen_wake_lock", event.target.checked));
    $("fullscreen-button").addEventListener("click", toggleFullscreen);
    $("reader-search-button").addEventListener("click", searchInDocument);
    $("reader-search-input").addEventListener("keydown", (event) => {
      if (event.key === "Enter") searchInDocument();
    });

    window.addEventListener("hashchange", route);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      state.installPrompt = event;
      $("install-button").classList.remove("hidden");
    });
    $("install-button").addEventListener("click", async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      $("install-button").classList.add("hidden");
    });
  }

  function openOfflineDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains("documents")) db.createObjectStore("documents", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function idbGet(storeName, key) {
    try {
      const db = await openOfflineDb();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("오프라인 저장소 읽기 실패", error);
      return null;
    }
  }

  async function idbGetAll(storeName) {
    try {
      const db = await openOfflineDb();
      return await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("오프라인 저장소 목록 실패", error);
      return [];
    }
  }

  async function idbPut(storeName, value) {
    try {
      const db = await openOfflineDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("오프라인 저장 실패", error);
    }
  }


  async function pruneDocumentCache(maxDocuments = 5) {
    const entries = await idbGetAll("documents");
    if (entries.length <= maxDocuments) return;
    entries.sort((a, b) => new Date(b.cachedAt || 0).getTime() - new Date(a.cachedAt || 0).getTime());
    for (const entry of entries.slice(maxDocuments)) {
      await idbDelete("documents", entry.id);
    }
  }

  async function idbDelete(storeName, key) {
    try {
      const db = await openOfflineDb();
      await new Promise((resolve, reject) => {
        const request = db.transaction(storeName, "readwrite").objectStore(storeName).delete(key);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (error) {
      console.warn("오프라인 문서 삭제 실패", error);
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try { await navigator.serviceWorker.register("./sw.js", { scope: "./" }); }
    catch (error) { console.warn("서비스 워커 등록 실패", error); }
  }

  async function bootstrap() {
    bindEvents();
    await registerServiceWorker();
    if (!initClient()) return;
    await initAuth();
  }

  bootstrap().catch((error) => {
    console.error(error);
    showToast("앱을 시작하지 못했습니다. 브라우저 콘솔을 확인해 주세요.", 5000);
  });
})();
