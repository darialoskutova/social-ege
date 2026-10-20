(function feedbackRendererModule(root, factory) {
    const api = factory();
    if (typeof module === "object" && module.exports) module.exports = api;
    if (root) root.EGE_FEEDBACK_RENDERER = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function createFeedbackRenderer() {
    "use strict";

    const namedEntities = Object.freeze({
        amp: "&",
        apos: "'",
        gt: ">",
        lt: "<",
        nbsp: "\u00a0",
        quot: '"',
    });

    function decodeEntities(value) {
        return String(value ?? "").replace(/&(#(?:x[0-9a-f]+|\d+)|amp|apos|gt|lt|nbsp|quot);/gi, (entity, code) => {
            if (code[0] !== "#") return namedEntities[code.toLowerCase()] ?? entity;
            const hexadecimal = code[1]?.toLowerCase() === "x";
            const number = Number.parseInt(code.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
            if (!Number.isInteger(number) || number < 0 || number > 0x10ffff || (number >= 0xd800 && number <= 0xdfff)) return entity;
            try {
                return String.fromCodePoint(number);
            } catch {
                return entity;
            }
        });
    }

    function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (character) => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
        })[character]);
    }

    function safeHref(value) {
        const href = decodeEntities(value).trim();
        if (/^https?:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href)) return href;
        return null;
    }

    function renderInline(value) {
        const text = String(value ?? "");
        const tokenPattern = /!\[([^\]]*)\]\(([^)]+)\)|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|__([^_]+)__/g;
        let result = "";
        let cursor = 0;
        let match;
        while ((match = tokenPattern.exec(text))) {
            result += escapeHtml(text.slice(cursor, match.index));
            if (match[1] !== undefined) {
                const href = safeHref(match[2]);
                const label = match[1].trim() || "изображение";
                result += href
                    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">Изображение: ${escapeHtml(label)}</a>`
                    : `Изображение: ${escapeHtml(label)}`;
            } else if (match[3] !== undefined) {
                const href = safeHref(match[4]);
                result += href
                    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${renderInline(match[3])}</a>`
                    : renderInline(match[3]);
            } else {
                result += `<strong>${renderInline(match[5] ?? match[6])}</strong>`;
            }
            cursor = tokenPattern.lastIndex;
        }
        return result + escapeHtml(text.slice(cursor));
    }

    function tableCells(line) {
        const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
        return trimmed.split("|").map((cell) => cell.trim());
    }

    function isTableDivider(line) {
        const cells = tableCells(line);
        return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
    }

    function startsBlock(lines, index) {
        const line = lines[index] || "";
        return /^#{1,6}\s+/.test(line)
            || /^\s*[-+*]\s+/.test(line)
            || /^\s*\d+[.)]\s+/.test(line)
            || (line.includes("|") && isTableDivider(lines[index + 1] || ""));
    }

    function formatFeedbackMarkdown(value) {
        const source = decodeEntities(value).replace(/\r\n?/g, "\n").trim();
        if (!source) return "";
        const lines = source.split("\n");
        const blocks = [];
        let index = 0;

        while (index < lines.length) {
            if (!lines[index].trim()) {
                index += 1;
                continue;
            }

            const heading = lines[index].match(/^(#{1,6})\s+(.+)$/);
            if (heading) {
                const level = Math.min(6, heading[1].length + 2);
                blocks.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
                index += 1;
                continue;
            }

            if (lines[index].includes("|") && isTableDivider(lines[index + 1] || "")) {
                const headings = tableCells(lines[index]);
                index += 2;
                const rows = [];
                while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
                    rows.push(tableCells(lines[index]));
                    index += 1;
                }
                blocks.push(`<div class="feedback-table-scroll" role="region" aria-label="Таблица в комментарии" tabindex="0"><table><thead><tr>${headings.map((cell) => `<th scope="col">${renderInline(cell)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${headings.map((_, cellIndex) => `<td>${renderInline(row[cellIndex] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
                continue;
            }

            const unordered = /^\s*[-+*]\s+/.test(lines[index]);
            const ordered = /^\s*\d+[.)]\s+/.test(lines[index]);
            if (unordered || ordered) {
                const pattern = unordered ? /^\s*[-+*]\s+(.+)$/ : /^\s*\d+[.)]\s+(.+)$/;
                const items = [];
                while (index < lines.length) {
                    const item = lines[index].match(pattern);
                    if (!item) break;
                    items.push(`<li>${renderInline(item[1])}</li>`);
                    index += 1;
                }
                const tag = unordered ? "ul" : "ol";
                blocks.push(`<${tag}>${items.join("")}</${tag}>`);
                continue;
            }

            const paragraph = [];
            while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) {
                paragraph.push(renderInline(lines[index].trim()));
                index += 1;
            }
            if (paragraph.length) blocks.push(`<p>${paragraph.join("<br>")}</p>`);
        }

        return blocks.join("");
    }

    function displayFilename(value) {
        const filename = String(value ?? "");
        if (!/%[0-9a-f]{2}/i.test(filename)) return decodeEntities(filename);
        try {
            return decodeEntities(decodeURIComponent(filename)).normalize("NFKC");
        } catch {
            return decodeEntities(filename);
        }
    }

    return Object.freeze({
        decodeEntities,
        displayFilename,
        formatFeedbackMarkdown,
    });
}));
