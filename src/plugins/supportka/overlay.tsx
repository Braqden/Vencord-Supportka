/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Brqden_
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { GuildMemberStore, GuildRoleStore, RestAPI, UserStore, VoiceStateStore } from "@webpack/common";

export interface OverlayRole {
    roleId: string;
    label: string;
    persist: boolean;
}

export interface OverlayOptions {
    roles: OverlayRole[];
    badgeColor: string;
}

const BADGE_ATTR = "data-vc-supportka-overlay-badge";

const AVATAR_RE = /(?:cdn\.discordapp\.com|discord\.com)\/(?:guilds\/\d+\/users\/(\d{17,20})\/avatars|avatars\/(\d{17,20}))\//i;

const ROLE_CACHE_TTL = 5 * 60 * 1000;
const FADE_DELAY = 3000;

let options: OverlayOptions | null = null;
let observer: MutationObserver | null = null;
let scanTimer: number | undefined;

const roleCache = new Map<string, string[]>();
const fadeAt = new Map<string, number>();
const roleIconCache = new Map<string, { url?: string; emoji?: string; } | null>();

function isOverlay(): boolean {
    return Boolean(window.__OVERLAY__);
}

function getGuildId(): string | null {
    try {
        const myId = UserStore.getCurrentUser()?.id;
        if (!myId) return null;
        return VoiceStateStore.getVoiceStateForUser(myId)?.guildId ?? null;
    } catch {
        return null;
    }
}

async function getRoles(guildId: string, userId: string): Promise<string[] | null> {
    const cached = roleCache.get(userId);
    if (cached) return cached;

    let roles: string[] | null = null;

    try {
        const member = GuildMemberStore.getMember(guildId, userId) as { roles?: string[]; } | undefined;
        if (member?.roles?.length) roles = member.roles;
    } catch {
        // store недоступен в оверлее — пробуем REST
    }

    if (!roles) {
        try {
            const { body } = await RestAPI.get({ url: `/guilds/${guildId}/members/${userId}` });
            roles = body?.roles?.length ? body.roles : [];
        } catch {
            return null;
        }
    }

    if (!roles) return null;

    roleCache.set(userId, roles);
    window.setTimeout(() => roleCache.delete(userId), ROLE_CACHE_TTL);
    return roles;
}

function matchRole(roles: string[]): OverlayRole | null {
    if (!options?.roles.length) return null;
    return options.roles.find(role => roles.includes(role.roleId)) ?? null;
}

function getRoleIcon(guildId: string, roleId: string): { url?: string; emoji?: string; } | null {
    try {
        const role = GuildRoleStore.getRole(guildId, roleId) as { icon?: string | null; } | undefined;
        const icon = role?.icon;
        if (!icon) return null;

        if (icon.startsWith("emoji:") || icon.startsWith("a:")) {
            const id = icon.split(":")[2];
            if (!id) return null;
            const animated = icon.startsWith("a:");
            return { url: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}?size=32` };
        }

        if (/^[0-9a-f]+$/i.test(icon)) {
            return { url: `${location.protocol}//${window.GLOBAL_ENV.CDN_HOST}/role-icons/${roleId}/${icon}.png?size=32` };
        }

        return { emoji: icon };
    } catch {
        return null;
    }
}

function buildRoleIcon(guildId: string, roleId: string): HTMLElement | null {
    if (!roleIconCache.has(roleId)) {
        roleIconCache.set(roleId, getRoleIcon(guildId, roleId));
    }
    const data = roleIconCache.get(roleId);
    if (!data) return null;

    if (data.url) {
        const img = document.createElement("img");
        img.src = data.url;
        img.alt = "";
        img.style.cssText = "width:14px;height:14px;display:block;border-radius:3px;flex:0 0 auto;";
        return img;
    }

    const span = document.createElement("span");
    span.textContent = data.emoji ?? "";
    span.style.cssText = "font-size:11px;line-height:1;display:block;";
    return span;
}

function ensureBadgeParent(el: HTMLElement): void {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
}

function createBadge(userId: string, guildId: string, role: OverlayRole): HTMLElement {
    const badge = document.createElement("span");
    badge.setAttribute(BADGE_ATTR, "true");
    badge.style.cssText = `position:absolute;right:-3px;bottom:-3px;display:flex;align-items:center;gap:3px;background:${options?.badgeColor || "#5865f2"};color:#fff;border-radius:6px;font-size:10px;line-height:1;padding:2px 4px;font-weight:700;z-index:20;pointer-events:none;box-shadow:0 1px 2px rgb(0 0 0 / 50%);white-space:nowrap;`;

    const icon = buildRoleIcon(guildId, role.roleId);
    if (icon) badge.appendChild(icon);

    const label = document.createElement("span");
    label.textContent = role.label;

    if (icon && !role.persist) {
        const existing = fadeAt.get(userId);
        const at = existing ?? Date.now() + FADE_DELAY;
        if (!existing) fadeAt.set(userId, at);
        const remaining = at - Date.now();
        label.style.transition = "opacity 0.5s ease";
        if (remaining <= 0) {
            label.style.opacity = "0";
        } else {
            window.setTimeout(() => {
                label.style.opacity = "0";
            }, remaining);
        }
    }

    badge.appendChild(label);
    return badge;
}

function applyBadge(parent: HTMLElement, userId: string, guildId: string, role: OverlayRole): void {
    if (parent.querySelector(`[${BADGE_ATTR}]`)) return;
    ensureBadgeParent(parent);
    parent.appendChild(createBadge(userId, guildId, role));
}

function removeBadge(parent: HTMLElement): void {
    parent.querySelectorAll(`[${BADGE_ATTR}]`).forEach(badge => badge.remove());
}

async function scan(): Promise<void> {
    if (!options) return;

    const guildId = getGuildId();
    if (!guildId) return;

    const imgs = document.querySelectorAll<HTMLImageElement>("img[src]");
    const parentsByUser = new Map<string, HTMLElement[]>();

    for (const img of imgs) {
        const match = (img.getAttribute("src") ?? "").match(AVATAR_RE);
        const userId = match?.[1] ?? match?.[2];
        if (!userId) continue;
        const parent = img.parentElement as HTMLElement | null;
        if (!parent) continue;
        const list = parentsByUser.get(userId);
        if (list) {
            if (!list.includes(parent)) list.push(parent);
        } else {
            parentsByUser.set(userId, [parent]);
        }
    }

    for (const [userId, parents] of parentsByUser) {
        const roles = await getRoles(guildId, userId);
        if (!roles) continue;
        const role = matchRole(roles);
        for (const parent of parents) {
            if (role) applyBadge(parent, userId, guildId, role);
            else removeBadge(parent);
        }
    }

    const current = new Set(parentsByUser.keys());
    for (const userId of [...fadeAt.keys()]) {
        if (!current.has(userId)) fadeAt.delete(userId);
    }

    document.querySelectorAll<HTMLElement>(`[${BADGE_ATTR}]`).forEach(badge => {
        const parent = badge.parentElement;
        if (!parent || !parent.querySelector("img[src]")) badge.remove();
    });
}

function scheduleScan(): void {
    if (scanTimer) return;
    scanTimer = window.setTimeout(() => {
        scanTimer = undefined;
        void scan();
    }, 200);
}

export function startOverlay(opts: OverlayOptions): void {
    if (!isOverlay()) return;
    options = opts;
    observer = new MutationObserver(scheduleScan);
    observer.observe(document.body ?? document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["src"]
    });
    scheduleScan();
}

export function stopOverlay(): void {
    observer?.disconnect();
    observer = null;
    if (scanTimer) {
        window.clearTimeout(scanTimer);
        scanTimer = undefined;
    }
    document.querySelectorAll<HTMLElement>(`[${BADGE_ATTR}]`).forEach(badge => badge.remove());
    options = null;
}
