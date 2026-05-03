/* global tinymce */
(function () {
    'use strict';

    const DEBUG_PREFIX = '[kbhint]';
    const MIN_QUERY_LEN = 3;
    const DEBOUNCE_MS = 300;
    const MAX_RESULTS = 5;
    const MAX_TOKENS = 8;
    // 'recall'    = OR across title + description tokens (wider net, all results ranked together).
    // 'precision' = title tokens required, description tokens only boost score.
    const MATCH_MODE = 'recall';
    // Common short words that, once turned into prefix-wildcard tokens (for*, the*, para*),
    // would match too broadly: MySQL FT does not apply its stopword filter to wildcard
    // prefixes. The default mirrors InnoDB's built-in English stopword list plus common
    // Spanish articles, prepositions, conjunctions, and pronouns. Admins can extend it with
    // site-specific entries; entries must be lowercase. Tokens shorter than MIN_QUERY_LEN
    // are dropped by the length check before this set is consulted, so the 2-char entries
    // here are documentation + defence-in-depth if MIN_QUERY_LEN is ever lowered.
    const STOPWORDS = new Set([
        // English (InnoDB default)
        'a', 'about', 'an', 'are', 'as', 'at', 'be', 'by', 'com', 'de', 'en', 'for', 'from',
        'how', 'i', 'in', 'is', 'it', 'la', 'of', 'on', 'or', 'that', 'the', 'this', 'to',
        'was', 'what', 'when', 'where', 'who', 'will', 'with', 'und', 'www',
        // Spanish
        'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'del', 'al', 'con', 'por', 'para',
        'que', 'se', 'lo', 'le', 'les', 'me', 'te', 'nos', 'mi', 'tu', 'su', 'sus',
        'es', 'son', 'fue', 'ser', 'esta', 'estan', 'como', 'pero', 'sino', 'cuando',
        'donde', 'quien', 'cual', 'si', 'no', 'ya', 'muy', 'mas', 'y', 'e', 'u', 'o',
    ]);

    if (!isFormRenderPage()) {
        return;
    }

    const root = readRootDoc();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    } else {
        bootstrap();
    }

    function bootstrap() {
        if (waitForRenderer(attachToRenderer)) {
            return;
        }
        const observer = new MutationObserver(() => {
            if (waitForRenderer(attachToRenderer)) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
    }

    function waitForRenderer(cb) {
        const formEl = document.getElementById('forms_form_answers');
        if (!formEl) {
            return false;
        }
        cb(formEl);
        return true;
    }

    function attachToRenderer(formEl) {
        const { titleInput, descriptionField } = discoverFields(formEl);
        if (!titleInput && !descriptionField) {
            console.warn(DEBUG_PREFIX, 'No title or description field discovered on this form.');
            return;
        }

        const state = {
            titleInput,
            descriptionField,
            anchorEl: titleInput || (descriptionField && descriptionField.anchor),
            controller: null,
            debounceHandle: null,
            dropdown: null,
            items: [],
            selectedIndex: -1,
            lastSource: null,
        };

        state.dropdown = createDropdown();
        document.body.appendChild(state.dropdown.root);

        bindInput(state);
        bindOutsideClick(state);
        bindReposition(state);
    }

    function discoverFields(formEl) {
        const sections = formEl.querySelectorAll('section[data-glpi-form-renderer-question]');
        let titleInput = null;
        let descriptionField = null;

        for (const section of sections) {
            if (!titleInput) {
                const candidate = section.querySelector('input[type="text"][name^="answers_"]');
                if (candidate) {
                    titleInput = candidate;
                }
            }
            if (!descriptionField) {
                const ta = section.querySelector('textarea[name^="answers_"]');
                if (ta) {
                    descriptionField = wrapDescription(ta, section);
                }
            }
            if (titleInput && descriptionField) {
                break;
            }
        }

        return { titleInput, descriptionField };
    }

    function wrapDescription(textarea, section) {
        const id = textarea.id;
        let pendingHandler = null;
        let editorAttached = false;
        const editorReadyCallbacks = [];

        const wrapper = {
            anchor: section || textarea,
            editor: null,
            getValue: () => textarea.value || '',
            onChange: (handler) => {
                pendingHandler = handler;
                textarea.addEventListener('input', handler);
                tryAttachTinyMCE();
            },
            whenEditorReady: (cb) => {
                if (wrapper.editor) {
                    cb(wrapper.editor);
                } else {
                    editorReadyCallbacks.push(cb);
                }
            },
        };

        function tryAttachTinyMCE() {
            if (editorAttached) {
                return true;
            }
            if (typeof tinymce === 'undefined' || !id) {
                return false;
            }
            const editor = tinymce.get(id);
            if (!editor) {
                return false;
            }
            editorAttached = true;
            wrapper.editor = editor;
            wrapper.getValue = () => editor.getContent({ format: 'text' }) || '';
            if (pendingHandler) {
                editor.on('input keyup change', () => pendingHandler());
            }
            for (const cb of editorReadyCallbacks) {
                cb(editor);
            }
            editorReadyCallbacks.length = 0;
            return true;
        }

        if (!tryAttachTinyMCE()) {
            if (typeof tinymce !== 'undefined' && typeof tinymce.on === 'function') {
                tinymce.on('AddEditor', (e) => {
                    if (e && e.editor && e.editor.id === id) {
                        tryAttachTinyMCE();
                    }
                });
            }
            let polls = 0;
            const poll = setInterval(() => {
                if (tryAttachTinyMCE() || ++polls > 50) {
                    clearInterval(poll);
                }
            }, 200);
        }

        return wrapper;
    }

    function bindInput(state) {
        if (state.titleInput) {
            state.titleInput.addEventListener('input', () => onTyping(state, state.titleInput));
            state.titleInput.addEventListener('focus', () => onTyping(state, state.titleInput));
            state.titleInput.addEventListener('keydown', (e) => onKeydown(state, e));
        }
        if (state.descriptionField) {
            state.descriptionField.onChange(() => onTyping(state, state.descriptionField.anchor));
            state.descriptionField.whenEditorReady((editor) => {
                if (typeof editor.on === 'function') {
                    editor.on('focus', () => onTyping(state, state.descriptionField.anchor));
                }
            });
        }
    }

    function onTyping(state, anchor) {
        state.anchorEl = anchor;
        clearTimeout(state.debounceHandle);
        state.debounceHandle = setTimeout(() => runQuery(state), DEBOUNCE_MS);
    }

    function runQuery(state) {
        const titleVal = state.titleInput ? state.titleInput.value : '';
        const descVal = state.descriptionField ? state.descriptionField.getValue() : '';

        const titleTokens = tokenize(titleVal);
        const descTokens = tokenize(descVal, titleTokens);
        const expression = buildBooleanExpression(titleTokens, descTokens);

        if (!expression) {
            render(state, []);
            return;
        }

        search(state, expression).then((results) => {
            if (results !== null) {
                render(state, results);
            }
        });
    }

    function tokenize(text, alreadySeen) {
        if (!text) {
            return [];
        }
        const seen = new Set(alreadySeen || []);
        const tokens = [];
        const matches = text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
        for (const tok of matches) {
            if (tok.length < MIN_QUERY_LEN) {
                continue;
            }
            if (STOPWORDS.has(tok)) {
                continue;
            }
            if (seen.has(tok)) {
                continue;
            }
            seen.add(tok);
            tokens.push(tok);
            if (tokens.length >= MAX_TOKENS) {
                break;
            }
        }
        return tokens;
    }

    function buildBooleanExpression(titleTokens, descTokens) {
        if (MATCH_MODE === 'recall') {
            const all = titleTokens.concat(descTokens);
            if (all.length === 0) {
                return '';
            }
            return all.map((t) => t + '*').join(' ');
        }
        const required = titleTokens.length > 0 ? titleTokens : descTokens;
        const boosters = titleTokens.length > 0 ? descTokens : [];
        if (required.length === 0) {
            return '';
        }
        const parts = [];
        for (const t of required) {
            parts.push('+' + t + '*');
        }
        for (const t of boosters) {
            parts.push(t + '*');
        }
        return parts.join(' ');
    }

    function search(state, value) {
        if (state.controller) {
            state.controller.abort();
        }
        state.controller = new AbortController();
        const params = new URLSearchParams();
        params.set('q', value);

        const url = root + '/plugins/kbhint/ajax/search.php?' + params.toString();
        return fetch(url, {
            credentials: 'same-origin',
            headers: { 'Accept': 'application/json' },
            signal: state.controller.signal,
        }).then((res) => {
            if (res.status === 403) {
                console.warn(DEBUG_PREFIX, 'KB search returned 403; ACL may have filtered results.');
                return [];
            }
            if (!res.ok) {
                console.warn(DEBUG_PREFIX, 'KB search failed:', res.status);
                return [];
            }
            return res.json();
        }).then((payload) => {
            if (!payload || !Array.isArray(payload.data)) {
                return [];
            }
            return payload.data.filter((item) => item && item.id && item.name);
        }).catch((err) => {
            if (err && err.name === 'AbortError') {
                return null;
            }
            console.warn(DEBUG_PREFIX, 'KB search error:', err);
            return [];
        });
    }

    function createDropdown() {
        const panel = document.createElement('div');
        panel.className = 'kbhint-panel';
        panel.hidden = true;

        const header = document.createElement('div');
        header.className = 'kbhint-header';
        header.textContent = 'Matching knowledge base articles';
        panel.appendChild(header);

        const ul = document.createElement('ul');
        ul.className = 'kbhint-list';
        ul.setAttribute('role', 'listbox');
        ul.setAttribute('aria-label', 'Knowledge base suggestions');
        panel.appendChild(ul);

        const live = document.createElement('span');
        live.className = 'kbhint-live';
        live.setAttribute('aria-live', 'polite');

        const root = document.createElement('div');
        root.className = 'kbhint-root';
        root.appendChild(panel);
        root.appendChild(live);

        return { root, panel, list: ul, live };
    }

    function render(state, results) {
        const list = state.dropdown.list;
        list.textContent = '';
        state.items = results.slice(0, MAX_RESULTS);
        state.selectedIndex = -1;

        if (state.items.length === 0) {
            state.dropdown.panel.hidden = true;
            state.dropdown.live.textContent = '';
            return;
        }

        for (const item of state.items) {
            const li = document.createElement('li');
            li.className = 'kbhint-item';
            li.setAttribute('role', 'option');

            const a = document.createElement('a');
            a.href = root + '/front/knowbaseitem.form.php?id=' + encodeURIComponent(item.id);
            a.target = '_blank';
            a.rel = 'noopener';
            a.textContent = stripTags(String(item.name));

            li.appendChild(a);
            list.appendChild(li);
        }

        state.dropdown.panel.hidden = false;
        positionDropdown(state);
        state.dropdown.live.textContent = state.items.length + ' suggestion' + (state.items.length === 1 ? '' : 's');
    }

    function positionDropdown(state) {
        if (!state.anchorEl || state.dropdown.panel.hidden) {
            return;
        }
        const rect = state.anchorEl.getBoundingClientRect();
        const top = rect.bottom + window.scrollY;
        const left = rect.left + window.scrollX;
        state.dropdown.panel.style.top = top + 'px';
        state.dropdown.panel.style.left = left + 'px';
        state.dropdown.panel.style.minWidth = rect.width + 'px';
    }

    function onKeydown(state, event) {
        if (state.dropdown.panel.hidden || state.items.length === 0) {
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveSelection(state, 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveSelection(state, -1);
        } else if (event.key === 'Enter' && state.selectedIndex >= 0) {
            event.preventDefault();
            const a = state.dropdown.list.children[state.selectedIndex].querySelector('a');
            if (a) {
                window.open(a.href, a.target || '_blank', 'noopener');
            }
        } else if (event.key === 'Escape') {
            state.dropdown.panel.hidden = true;
        }
    }

    function moveSelection(state, delta) {
        const next = (state.selectedIndex + delta + state.items.length) % state.items.length;
        for (const li of state.dropdown.list.children) {
            li.removeAttribute('aria-selected');
        }
        const target = state.dropdown.list.children[next];
        target.setAttribute('aria-selected', 'true');
        state.selectedIndex = next;
    }

    function bindOutsideClick(state) {
        document.addEventListener('pointerdown', (event) => {
            const target = event.target;
            if (target.closest && target.closest('.kbhint-panel')) {
                return;
            }
            if (state.titleInput && state.titleInput.contains && state.titleInput.contains(target)) {
                return;
            }
            if (state.descriptionField && state.descriptionField.anchor && state.descriptionField.anchor.contains && state.descriptionField.anchor.contains(target)) {
                return;
            }
            state.dropdown.panel.hidden = true;
        });

        if (state.descriptionField && typeof state.descriptionField.whenEditorReady === 'function') {
            state.descriptionField.whenEditorReady((editor) => {
                const dismissIfNotForUs = () => {
                    if (state.anchorEl !== state.descriptionField.anchor) {
                        state.dropdown.panel.hidden = true;
                    }
                };
                if (typeof editor.on === 'function') {
                    editor.on('click mousedown', dismissIfNotForUs);
                }
                const doc = typeof editor.getDoc === 'function' ? editor.getDoc() : null;
                if (doc) {
                    doc.addEventListener('mousedown', dismissIfNotForUs, true);
                    doc.addEventListener('pointerdown', dismissIfNotForUs, true);
                }
            });
        }
    }

    function bindReposition(state) {
        const reposition = () => positionDropdown(state);
        window.addEventListener('scroll', reposition, true);
        window.addEventListener('resize', reposition);
    }

    function isFormRenderPage() {
        return /\/Form\/Render\/\d+/.test(window.location.pathname);
    }

    function readRootDoc() {
        if (window.CFG_GLPI && typeof window.CFG_GLPI.root_doc === 'string') {
            return window.CFG_GLPI.root_doc;
        }
        return '';
    }

    function stripTags(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }
})();
