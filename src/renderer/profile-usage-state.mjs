export function createProfileUsageStateToolkit() {
  const refreshMs = 5 * 60_000;
  const retryMs = 60_000;
  const timeoutMs = 8_000;

  function localDateKey(now = Date.now()) {
    const date = new Date(Number(now));
    if (!Number.isFinite(date.getTime())) return "";
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function tokenCount(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }

  function emptyProfileUsage(status = "idle", now = Date.now()) {
    return {
      status,
      todayTokens: null,
      lifetimeTokens: null,
      receivedAt: 0,
      attemptedAt: Number(now) || 0,
    };
  }

  function normalizeProfileUsage(payload, now = Date.now()) {
    const stats = payload?.stats;
    if (!stats || typeof stats !== "object") return emptyProfileUsage("unavailable", now);
    const buckets = Array.isArray(stats.daily_usage_buckets) ? stats.daily_usage_buckets : null;
    const todayKey = localDateKey(now);
    const todayBucket = buckets?.find((bucket) => String(bucket?.start_date ?? "").slice(0, 10) === todayKey);
    // The personal profile endpoint is a settled daily series. Absence of the
    // current date means "not published yet", not zero usage.
    const todayTokens = todayBucket ? tokenCount(todayBucket.tokens) : null;
    const lifetimeTokens = tokenCount(stats.lifetime_tokens);
    if (todayTokens === null && lifetimeTokens === null) return emptyProfileUsage("unavailable", now);
    const statsError = typeof payload?.metadata?.stats_error === "string" && payload.metadata.stats_error.trim().length > 0;
    return {
      status: statsError ? "partial" : "ready",
      todayTokens,
      lifetimeTokens,
      receivedAt: Number(now) || Date.now(),
      attemptedAt: Number(now) || Date.now(),
    };
  }

  function formatTokenCount(value, locale = "en") {
    const parsed = tokenCount(value);
    if (parsed === null) return "—";
    try {
      return new Intl.NumberFormat(locale, {
        notation: "compact",
        compactDisplay: "short",
        maximumFractionDigits: parsed < 1_000 ? 0 : 1,
      }).format(parsed);
    } catch {
      return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(parsed);
    }
  }

  function formatExactTokenCount(value, locale = "en") {
    const parsed = tokenCount(value);
    if (parsed === null) return "—";
    try {
      return new Intl.NumberFormat(locale, { useGrouping: true, maximumFractionDigits: 0 }).format(parsed);
    } catch {
      return new Intl.NumberFormat("en", { useGrouping: true, maximumFractionDigits: 0 }).format(parsed);
    }
  }

  function formatProfileUsageParts(usage, locale = "en") {
    const language = String(locale ?? "").toLowerCase();
    const labels = language.startsWith("zh")
      ? { today: "今日", lifetime: "累计", todayTitle: "今天已用 token", lifetimeTitle: "累计 token" }
      : language.startsWith("ja")
        ? { today: "今日", lifetime: "累計", todayTitle: "今日使用したトークン", lifetimeTitle: "累計トークン" }
        : { today: "Today", lifetime: "Total", todayTitle: "Tokens used today", lifetimeTitle: "Lifetime tokens" };
    const today = formatTokenCount(usage?.todayTokens, locale);
    const lifetime = formatTokenCount(usage?.lifetimeTokens, locale);
    const todayExact = formatExactTokenCount(usage?.todayTokens, locale);
    const lifetimeExact = formatExactTokenCount(usage?.lifetimeTokens, locale);
    const todayEstimated = usage?.todayEstimated === true && today !== "—";
    const todayTitle = usage?.todaySource === "device"
      ? language.startsWith("zh")
        ? "今天在这台设备处理的 token"
        : language.startsWith("ja")
          ? "今日このデバイスで処理したトークン"
          : "Tokens processed on this device today"
      : labels.todayTitle;
    const lowerBound = todayEstimated
      ? language.startsWith("zh")
        ? "（至少）"
        : language.startsWith("ja")
          ? "（少なくとも）"
          : " (at least)"
      : "";
    return {
      todayTokens: `${labels.today} ${today}`,
      lifetimeTokens: `${labels.lifetime} ${lifetime}`,
      todayTokensTitle: `${todayTitle}${lowerBound}: ${todayExact}`,
      lifetimeTokensTitle: `${labels.lifetimeTitle}: ${lifetimeExact}`,
      tooltip: `${todayTitle}${lowerBound}: ${todayExact}\n${labels.lifetimeTitle}: ${lifetimeExact}`,
    };
  }

  function nextRefreshDelay(usage, now = Date.now()) {
    const attemptedAt = Number(usage?.attemptedAt) || 0;
    const receivedAt = Number(usage?.receivedAt) || 0;
    const ready = ["ready", "partial"].includes(usage?.status) && receivedAt > 0;
    const base = ready ? receivedAt : attemptedAt;
    const interval = ready ? refreshMs : retryMs;
    return Math.max(0, base + interval - Number(now));
  }

  function shouldRefreshProfileUsage(usage, now = Date.now()) {
    if (usage?.status === "loading") return false;
    return nextRefreshDelay(usage, now) <= 0;
  }

  return {
    refreshMs,
    retryMs,
    timeoutMs,
    localDateKey,
    emptyProfileUsage,
    normalizeProfileUsage,
    formatTokenCount,
    formatExactTokenCount,
    formatProfileUsageParts,
    nextRefreshDelay,
    shouldRefreshProfileUsage,
  };
}
