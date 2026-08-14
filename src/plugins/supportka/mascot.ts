/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brqden_
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";

import { MASCOT_IMAGE } from "./mascot-image";

export const MASCOT_SITE_URL = "https://mita-new-stand.whyrmph.ru/app/replacements";

const cl = classNameFactory("vc-supportka-");

const SIZE_W = 110;
const SIZE_H = 165;
const MARGIN = 12;
const SPEED = 80; // px/сек
const MIN_IDLE_MS = 600;
const MAX_IDLE_MS = 3500;
const CLICK_WINDOW_MS = 1500;
const REQUIRED_CLICKS = 3;

let el: HTMLDivElement | null = null;
let img: HTMLImageElement | null = null;
let raf = 0;
let clickedTimer = 0;
let lastTs = 0;
let x = MARGIN;
let y = MARGIN;
let tx = MARGIN;
let ty = MARGIN;
let lastX = Number.NaN;
let lastY = Number.NaN;
let lastFlipped = false;
let walking = false;
let idleUntil = 0;
let flipped = false;
let clickTimes: number[] = [];
let dragging = false;
let dragId = 0;
let downX = 0;
let downY = 0;
let startX = 0;
let startY = 0;
let justDragged = false;

function maxX() {
    return Math.max(window.innerWidth - SIZE_W - MARGIN, MARGIN);
}

function maxY() {
    return Math.max(window.innerHeight - SIZE_H - MARGIN, MARGIN);
}

function pickTarget() {
    tx = MARGIN + Math.random() * (maxX() - MARGIN);
    ty = MARGIN + Math.random() * (maxY() - MARGIN);
}

function onResize() {
    x = Math.min(Math.max(x, MARGIN), maxX());
    y = Math.min(Math.max(y, MARGIN), maxY());
    tx = Math.min(Math.max(tx, MARGIN), maxX());
    ty = Math.min(Math.max(ty, MARGIN), maxY());
}

function updateTransform() {
    if (!el) return;
    if (x === lastX && y === lastY && flipped === lastFlipped) return;
    lastX = x;
    lastY = y;
    lastFlipped = flipped;
    el.style.transform = `translate(${x}px, ${y}px) scaleX(${flipped ? -1 : 1})`;
}

function tick(ts: number) {
    raf = requestAnimationFrame(tick);
    if (!el || !img) return;
    if (dragging) return;
    const dt = lastTs ? Math.min(ts - lastTs, 100) : 0;
    lastTs = ts;

    if (!walking) {
        if (ts >= idleUntil) {
            walking = true;
            pickTarget();
            if (flipped !== tx < x) {
                flipped = tx < x;
            }
        }
    } else {
        const dx = tx - x;
        const dy = ty - y;
        const dist = Math.hypot(dx, dy);
        const step = (SPEED * dt) / 1000;
        if (dist <= step) {
            x = tx;
            y = ty;
            walking = false;
            idleUntil = ts + MIN_IDLE_MS + Math.random() * (MAX_IDLE_MS - MIN_IDLE_MS);
        } else {
            x += (dx / dist) * step;
            y += (dy / dist) * step;
        }
    }

    if (walking) {
        if (!el.classList.contains("walking")) el.classList.add("walking");
    } else if (el.classList.contains("walking")) {
        el.classList.remove("walking");
    }
    updateTransform();
}

function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    dragging = true;
    dragId = e.pointerId;
    downX = e.clientX;
    downY = e.clientY;
    startX = x;
    startY = y;
    justDragged = false;
    el?.classList.add("dragging");
}

function onPointerMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragId) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (Math.hypot(dx, dy) > 4) justDragged = true;
    x = Math.min(Math.max(startX + dx, MARGIN), maxX());
    y = Math.min(Math.max(startY + dy, MARGIN), maxY());
    updateTransform();
}

function onPointerUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== dragId) return;
    dragging = false;
    el?.classList.remove("dragging");
    walking = false;
    idleUntil = performance.now() + 900;
    lastTs = 0;
}

function onMascotClick(e: MouseEvent) {
    if (justDragged) {
        justDragged = false;
        return;
    }
    e.preventDefault();
    e.stopPropagation();

    const now = performance.now();
    clickTimes.push(now);
    clickTimes = clickTimes.filter(t => now - t <= CLICK_WINDOW_MS);

    walking = false;
    idleUntil = now + 700;

    el?.classList.add("clicked");
    if (clickedTimer) window.clearTimeout(clickedTimer);
    clickedTimer = window.setTimeout(() => el?.classList.remove("clicked"), 180);

    if (clickTimes.length >= REQUIRED_CLICKS) {
        clickTimes = [];
        VencordNative.native.openExternal(MASCOT_SITE_URL);
    }
}

export function startMascot() {
    if (el) return;
    el = document.createElement("div");
    el.className = cl("mascot");
    el.title = "Тыкни 3 раза — откроется сайт";
    img = document.createElement("img");
    img.src = MASCOT_IMAGE;
    img.alt = "Mita";
    img.draggable = false;
    el.appendChild(img);
    el.addEventListener("click", onMascotClick);
    el.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    document.body.appendChild(el);

    x = MARGIN;
    y = MARGIN + Math.random() * (maxY() - MARGIN);
    walking = false;
    idleUntil = 0;
    lastTs = 0;
    flipped = false;
    clickTimes = [];

    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(tick);
}

export function stopMascot() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (clickedTimer) window.clearTimeout(clickedTimer);
    clickedTimer = 0;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    el?.remove();
    el = null;
    img = null;
    clickTimes = [];
    dragging = false;
    justDragged = false;
}
