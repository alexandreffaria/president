/**
 * The batch files npm's cmd-shim (v7, lib/index.js) writes on Windows for a package's bin:
 * `target` is the bin's path from the shim's folder, with backslashes.
 */

const HEAD =
  "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n";

/** For a script with `#!/usr/bin/env node`: Node (next to the shim, or on PATH) runs it. */
export function nodeShim(target: string): string {
  return (
    HEAD +
    "\r\n" +
    'IF EXIST "%dp0%\\node.exe" (\r\n' +
    '  SET "_prog=%dp0%\\node.exe"\r\n' +
    ") ELSE (\r\n" +
    '  SET "_prog=node"\r\n' +
    ")\r\n" +
    "\r\n" +
    "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & " +
    `set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"  "%dp0%\\${target}" %*\r\n`
  );
}

/** For a program (no `#!`), such as today's `bin/claude.exe`: the shim starts it directly. */
export function programShim(target: string): string {
  return `${HEAD}"%dp0%\\${target}"   %*\r\n`;
}
