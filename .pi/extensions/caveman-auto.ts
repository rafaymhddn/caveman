/**
 * Caveman Auto-Activation Extension for Pi
 *
 * Replicates Claude Code's SessionStart hook behavior:
 * - Auto-activates caveman mode on session start (configurable)
 * - Registers /caveman command for mode switching (lite/full/ultra/wenyan)
 * - Registers /caveman-commit, /caveman-review, /caveman-help commands
 *
 * Backward compatible: does NOT interfere with Claude Code's plugin/hooks system.
 *
 * Configuration in ~/.pi/settings.json or .pi/settings.json:
 *   { "caveman": { "autoActivate": true, "defaultLevel": "full" } }
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const LEVELS = ["lite", "full", "ultra", "wenyan-lite", "wenyan-full", "wenyan", "wenyan-ultra"] as const;
type CavemanLevel = (typeof LEVELS)[number];

// wenyan-full is an alias for wenyan
const LEVEL_ALIASES: Record<string, CavemanLevel> = {
	"wenyan-full": "wenyan",
};

function resolveLevel(raw: string): CavemanLevel | undefined {
	const resolved = LEVEL_ALIASES[raw] ?? raw;
	return LEVELS.includes(resolved as CavemanLevel) ? resolved as CavemanLevel : undefined;
}

const LEVEL_PROMPTS: Record<CavemanLevel, string> = {
	lite: `Respond terse. No filler/hedging. Keep articles + full sentences. Professional but tight. Still active every response. Off only: "stop caveman" / "normal mode".`,
	full: `Respond terse like smart caveman. All technical substance stay. Only fluff die.
Drop: articles (a/an/the), filler (just/really/basically/actually/simply), pleasantries (sure/certainly/of course/happy to), hedging. Fragments OK. Short synonyms (big not extensive, fix not "implement a solution for"). Technical terms exact. Code blocks unchanged.
Pattern: [thing] [action] [reason]. [next step].
ACTIVE EVERY RESPONSE. No revert after many turns. No filler drift. Off only: "stop caveman" / "normal mode".`,
	ultra: `Respond ultra-compressed. Abbreviate (DB/auth/config/req/res/fn/impl), strip conjunctions, arrows for causality (X → Y), one word when one word enough.
ACTIVE EVERY RESPONSE. No revert. Off only: "stop caveman" / "normal mode".`,
	"wenyan-lite": `Respond in semi-classical Chinese (文言文-lite). Drop filler/hedging but keep grammar structure, classical register.
ACTIVE EVERY RESPONSE. Off only: "stop caveman" / "normal mode".`,
	wenyan: `Respond in full 文言文 (classical Chinese). Maximum classical terseness. 80-90% character reduction. Classical sentence patterns, verbs precede objects, subjects often omitted, classical particles (之/乃/為/其).
ACTIVE EVERY RESPONSE. Off only: "stop caveman" / "normal mode".`,
	"wenyan-ultra": `Respond in extreme 文言文-ultra. Maximum compression, ultra terse classical Chinese.
ACTIVE EVERY RESPONSE. Off only: "stop caveman" / "normal mode".`,
};

const COMMIT_PROMPT = `Generate a terse commit message. Conventional Commits format. Subject ≤50 chars. Focus on WHY over WHAT. No throat-clearing prefix. Just the message.`;

const REVIEW_PROMPT = `Review this code. One-line per finding. Format: L{line}: {emoji} {type}: {what}. {fix suggestion}. Emojis: 🔴 bug, 🟡 style/nit, 🟢 good. No throat-clearing.`;

export default function cavemanExtension(pi: ExtensionAPI) {
	let active = false;
	let level: CavemanLevel = "full";

	// Read settings from ~/.pi/settings.json + .pi/settings.json (project overrides home)
	function getSettings() {
		try {
			const fs = require("node:fs");
			const path = require("node:path");
			const home = process.env.HOME || process.env.USERPROFILE || "";
			let merged: any = {};

			// Global settings
			const globalPath = path.join(home, ".pi", "settings.json");
			if (fs.existsSync(globalPath)) {
				const raw = JSON.parse(fs.readFileSync(globalPath, "utf8"));
				if (raw.caveman) merged = { ...merged, ...raw.caveman };
			}

			// Project settings (cwd or ancestor with .pi/)
			const projectPath = path.join(process.cwd(), ".pi", "settings.json");
			if (fs.existsSync(projectPath)) {
				const raw = JSON.parse(fs.readFileSync(projectPath, "utf8"));
				if (raw.caveman) merged = { ...merged, ...raw.caveman };
			}

			return merged;
		} catch {
			// ignore
		}
		return {};
	}

	const settings = getSettings();
	if (settings.autoActivate !== false) {
		active = true;
	}
	if (settings.defaultLevel) {
		const resolved = resolveLevel(settings.defaultLevel);
		if (resolved) level = resolved;
	}

	// Helper: update footer status indicator
	function updateStatus(ctx: any) {
		try {
			if (active) {
				ctx.ui.setStatus("caveman", `🪨 ${level.toUpperCase()}`);
			} else {
				ctx.ui.setStatus("caveman", "");
			}
		} catch {
			// setStatus not available in all pi versions
		}
	}

	// Auto-activate on session start
	pi.on("session_start", async (_event, ctx) => {
		if (active) {
			ctx.ui.notify(`🪨 Caveman mode: ${level}`, "info");
			updateStatus(ctx);
		}
	});

	// Inject caveman instructions into system prompt when active
	pi.on("before_agent_start", async (event) => {
		if (!active) return undefined;

		const prompt = LEVEL_PROMPTS[level] ?? LEVEL_PROMPTS.full;

		// Auto-clarity rules (from original SKILL.md)
		const autoClarity = `
Auto-Clarity: Drop caveman for: security warnings, irreversible action confirmations, multi-step sequences where fragment order risks misread, user asks to clarify or repeats question. Resume caveman after clear part done.
Boundaries: Code/commits/PRs: write normal. "stop caveman" or "normal mode": revert.`;

		return {
			systemPrompt: event.systemPrompt + `\n\n🪨 CAVEMAN MODE [${level.toUpperCase()}]:\n${prompt}\n${autoClarity}`,
		};
	});

	// Register /caveman command for mode switching
	pi.registerCommand("caveman", {
		description: "Caveman mode: toggle or switch level (lite/full/ultra/wenyan/wenyan-lite/wenyan-ultra)",
		getArgumentCompletions: (prefix: string) => {
			const items = [
				{ value: "", label: "toggle on/off" },
				...LEVELS.map((l) => ({ value: l, label: l })),
			];
			const filtered = items.filter((i) => i.value.startsWith(prefix) || i.label.startsWith(prefix));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();

			// Toggle off
			if (arg === "off" || arg === "stop" || arg === "disable") {
				active = false;
				ctx.ui.notify("🪨 Caveman mode OFF. Normal mode.", "info");
				updateStatus(ctx);
				return;
			}

			// No args: toggle (show current state)
			if (arg === "") {
				active = !active;
				ctx.ui.notify(active ? `🪨 Caveman mode: ${level}` : "🪨 Caveman mode OFF.", "info");
				updateStatus(ctx);
				return;
			}

			// Explicit on
			if (arg === "on" || arg === "enable") {
				active = true;
				ctx.ui.notify(`🪨 Caveman mode: ${level}`, "info");
				updateStatus(ctx);
				return;
			}

			// Switch level (supports aliases like wenyan-full)
			const resolved = resolveLevel(arg);
			if (resolved) {
				level = resolved;
				active = true;
				ctx.ui.notify(`🪨 Caveman mode: ${level}`, "info");
				updateStatus(ctx);
				return;
			}

			ctx.ui.notify(`Unknown level: ${arg}. Use: ${LEVELS.join(", ")}`, "error");
		},
	});

	// Register /caveman-commit
	pi.registerCommand("caveman-commit", {
		description: "Generate a terse caveman commit message",
		handler: async (_args, ctx) => {
			ctx.ui.setEditorText(COMMIT_PROMPT);
			ctx.ui.notify("🪨 Commit prompt loaded — press Enter to generate", "info");
		},
	});

	// Register /caveman-review
	pi.registerCommand("caveman-review", {
		description: "One-line code review with emoji severity",
		handler: async (_args, ctx) => {
			ctx.ui.setEditorText(REVIEW_PROMPT);
			ctx.ui.notify("🪨 Review prompt loaded — press Enter to run", "info");
		},
	});

	// Register /caveman-help
	pi.registerCommand("caveman-help", {
		description: "Show caveman quick-reference card",
		handler: async (_args, ctx) => {
			const help = [
				"🪨 CAVEMAN — Quick Reference",
				"",
				"Commands:",
				"  /caveman          — toggle on/off",
				"  /caveman lite     — no filler, keep grammar",
				"  /caveman full     — drop articles, fragments (default)",
				"  /caveman ultra    — max compression, abbreviate all",
				"  /caveman wenyan   — classical Chinese mode",
				"  /caveman-commit   — terse commit message",
				"  /caveman-review   — one-line code review",
				"",
				"Config (~/.pi/settings.json):",
				'  { "caveman": { "autoActivate": true, "defaultLevel": "full" } }',
				"",
				"Disable: /caveman off or say 'stop caveman'",
			];
			ctx.ui.notify(help.join("\n"), "info");
		},
	});
}
