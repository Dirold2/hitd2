export const HITMOS_HOSTS = ["rus.hitmos.fm", "hitmos.fm", "www.hitmos.fm"];
export const HITMOZ_HOSTS = [
  "rue.hitmoz.org",
  "ru.hitmoz.org",
  "rus.hitmoz.org",
  "hitmoz.org",
  "www.hitmoz.org",
];

export const SEARCH_HOSTS = [...HITMOS_HOSTS, ...HITMOZ_HOSTS];

export function isDomainHost(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function isSupportedHost(host: string): boolean {
  return providerForHost(host) !== undefined;
}

/** Read lazily so applications can load their environment before creating the API. */
export function getSearchHosts(value = process.env.HITD2_HOSTS): string[] {
  if (value === undefined) {
    const configured = Object.values(getConfiguredMirrors()).flat();
    return configured.length ? configured : [...SEARCH_HOSTS];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("HITD2_HOSTS must be a non-empty JSON array of Hitmo hostnames");
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("HITD2_HOSTS must be a non-empty JSON array of Hitmo hostnames");
  }

  const hosts = parsed.map((value: unknown) => {
    if (typeof value !== "string") throw new Error("HITD2_HOSTS entries must be hostnames");
    const host = value.trim().toLowerCase();
    const labels = host.split(".");
    if (
      !isSupportedHost(host) ||
      host.length > 253 ||
      labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    ) {
      throw new Error(`Unsupported hostname in HITD2_HOSTS: ${value}`);
    }
    return host;
  });

  return [...new Set(hosts)];
}

export function isSupportedPageUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    !url.username &&
    !url.password &&
    !url.port &&
    isSupportedHost(url.hostname)
  );
}

export type HostProvider = "hitmos" | "hitmoz";

function parseHostArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array of hostnames`);
  }
  return [
    ...new Set(
      value.map((entry: unknown) => {
        if (typeof entry !== "string") throw new Error(`${name} entries must be hostnames`);
        const host = entry.trim().toLowerCase();
        if (
          host.length > 253 ||
          !host.includes(".") ||
          /^\d+(?:\.\d+){3}$/.test(host) ||
          host.split(".").some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
        ) {
          throw new Error(`Invalid hostname in ${name}: ${entry}`);
        }
        return host;
      }),
    ),
  ];
}

function parseEnvironmentJson(value: string, name: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${name} must contain valid JSON`);
  }
}

export function getConfiguredMirrors(): Partial<Record<HostProvider, string[]>> {
  const value = process.env.HITD2_MIRRORS;
  if (value === undefined) return {};
  const parsed = parseEnvironmentJson(value, "HITD2_MIRRORS");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HITD2_MIRRORS must be an object with hitmos and/or hitmoz arrays");
  }
  const result: Partial<Record<HostProvider, string[]>> = {};
  const entries = Object.entries(parsed);
  if (!entries.length) throw new Error("HITD2_MIRRORS must not be empty");
  for (const [provider, hosts] of entries) {
    if (provider !== "hitmos" && provider !== "hitmoz") {
      throw new Error(`Unknown provider in HITD2_MIRRORS: ${provider}`);
    }
    result[provider] = parseHostArray(hosts, "HITD2_MIRRORS");
  }
  if (result.hitmos?.some((host) => result.hitmoz?.includes(host))) {
    throw new Error("HITD2_MIRRORS cannot assign a host to both providers");
  }
  for (const [provider, hosts] of Object.entries(result)) {
    for (const host of hosts) {
      const builtin = builtinProvider(host);
      if (builtin && builtin !== provider)
        throw new Error("HITD2_MIRRORS cannot reassign built-in domains");
    }
  }
  return result;
}

function builtinProvider(host: string): HostProvider | undefined {
  if (isDomainHost(host, "hitmos.fm")) return "hitmos";
  if (isDomainHost(host, "hitmoz.org")) return "hitmoz";
  return undefined;
}

export function providerForHost(host: string): HostProvider | undefined {
  const mirrors = getConfiguredMirrors();
  if (mirrors.hitmos?.includes(host)) return "hitmos";
  if (mirrors.hitmoz?.includes(host)) return "hitmoz";
  return builtinProvider(host);
}

export function isTrustedAudioHost(host: string): boolean {
  if (["hitmos.fm", "hitmos.me", "hitmoz.org"].some((domain) => isDomainHost(host, domain)))
    return true;
  if (Object.values(getConfiguredMirrors()).some((hosts) => hosts.includes(host))) return true;
  const value = process.env.HITD2_AUDIO_HOSTS;
  return (
    value !== undefined &&
    parseHostArray(parseEnvironmentJson(value, "HITD2_AUDIO_HOSTS"), "HITD2_AUDIO_HOSTS").includes(
      host,
    )
  );
}
