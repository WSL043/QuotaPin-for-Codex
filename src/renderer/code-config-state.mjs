export function createCodeConfigStateToolkit() {
  function firstInvalidJsonOffset(source) {
    const text = String(source ?? "");
    let offset = 0;
    const fail = (at = offset) => {
      const error = new Error("Invalid JSON");
      error.offset = Math.max(0, Math.min(text.length, at));
      throw error;
    };
    const skipWhitespace = () => {
      while (offset < text.length && /\s/.test(text[offset])) offset += 1;
    };
    const parseString = () => {
      if (text[offset] !== '"') fail();
      offset += 1;
      while (offset < text.length) {
        const character = text[offset];
        if (character === '"') {
          offset += 1;
          return;
        }
        if (character === "\\") {
          offset += 1;
          if (offset >= text.length) fail();
          if (text[offset] === "u") {
            if (!/^[0-9a-fA-F]{4}$/.test(text.slice(offset + 1, offset + 5))) fail();
            offset += 5;
            continue;
          }
          if (!'"\\/bfnrt'.includes(text[offset])) fail();
          offset += 1;
          continue;
        }
        if (character.charCodeAt(0) < 0x20) fail();
        offset += 1;
      }
      fail(text.length);
    };
    const parseValue = () => {
      skipWhitespace();
      const character = text[offset];
      if (character === '"') return parseString();
      if (character === "{") return parseObject();
      if (character === "[") return parseArray();
      for (const literal of ["true", "false", "null"]) {
        if (text.startsWith(literal, offset)) {
          offset += literal.length;
          return;
        }
      }
      const number = text.slice(offset).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (number) {
        offset += number[0].length;
        return;
      }
      fail();
    };
    const parseArray = () => {
      offset += 1;
      skipWhitespace();
      if (text[offset] === "]") {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        parseValue();
        skipWhitespace();
        if (text[offset] === "]") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") fail();
        offset += 1;
      }
      fail(text.length);
    };
    const parseObject = () => {
      offset += 1;
      skipWhitespace();
      if (text[offset] === "}") {
        offset += 1;
        return;
      }
      while (offset < text.length) {
        skipWhitespace();
        parseString();
        skipWhitespace();
        if (text[offset] !== ":") fail();
        offset += 1;
        parseValue();
        skipWhitespace();
        if (text[offset] === "}") {
          offset += 1;
          return;
        }
        if (text[offset] !== ",") fail();
        offset += 1;
      }
      fail(text.length);
    };
    try {
      parseValue();
      skipWhitespace();
      if (offset !== text.length) fail();
      return null;
    } catch (error) {
      return Number.isFinite(error?.offset) ? error.offset : offset;
    }
  }

  function syntaxLocation(source, error) {
    const text = String(source ?? "");
    const message = String(error?.message ?? "");
    const direct = message.match(/line\s+(\d+)\s+column\s+(\d+)/i);
    if (direct) return { line: Number(direct[1]), column: Number(direct[2]) };
    const positioned = message.match(/position\s+(\d+)/i);
    const parsedOffset = positioned ? Number(positioned[1]) : firstInvalidJsonOffset(text);
    if (!Number.isFinite(parsedOffset)) return { line: null, column: null };
    const offset = Math.max(0, Math.min(text.length, parsedOffset));
    const before = text.slice(0, offset);
    const lines = before.split(/\r?\n/);
    return { line: lines.length, column: (lines[lines.length - 1]?.length ?? 0) + 1 };
  }

  function parseJsonDraft(source) {
    try {
      return { ok: true, value: JSON.parse(String(source ?? "")), error: null };
    } catch (error) {
      const location = syntaxLocation(source, error);
      return {
        ok: false,
        value: null,
        error: { message: String(error?.message ?? "Invalid JSON"), ...location },
      };
    }
  }

  function formatJsonDraft(source) {
    const parsed = parseJsonDraft(source);
    return parsed.ok ? { ...parsed, text: JSON.stringify(parsed.value, null, 2) } : { ...parsed, text: String(source ?? "") };
  }

  function diffJsonPaths(left, right, limit = 8) {
    const differences = [];
    const maximum = Math.max(1, Number(limit) || 8);
    const visit = (a, b, path = "$") => {
      if (differences.length >= maximum) return;
      if (Object.is(a, b)) return;
      const aArray = Array.isArray(a);
      const bArray = Array.isArray(b);
      if (aArray || bArray) {
        if (!aArray || !bArray || a.length !== b.length) differences.push(path);
        if (!aArray || !bArray) return;
        for (let index = 0; index < Math.max(a.length, b.length) && differences.length < maximum; index += 1) {
          if (index >= a.length || index >= b.length) continue;
          visit(a[index], b[index], `${path}[${index}]`);
        }
        return;
      }
      const aObject = a !== null && typeof a === "object";
      const bObject = b !== null && typeof b === "object";
      if (aObject || bObject) {
        if (!aObject || !bObject) {
          differences.push(path);
          return;
        }
        const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
        for (const key of keys) {
          if (differences.length >= maximum) return;
          const next = /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
          if (!Object.hasOwn(a, key) || !Object.hasOwn(b, key)) differences.push(next);
          else visit(a[key], b[key], next);
        }
        return;
      }
      differences.push(path);
    };
    visit(left, right);
    return differences;
  }

  return { parseJsonDraft, formatJsonDraft, diffJsonPaths };
}
