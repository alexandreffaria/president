/**
 * The batch files npm's cmd-shim writes on Windows for a package's bin (its lib/index.js):
 * `target` is the bin's path from the shim's folder, with backslashes.
 */

const HEAD =
  "@ECHO off\r\nGOTO start\r\n:find_dp0\r\nSET dp0=%~dp0\r\nEXIT /b\r\n:start\r\nSETLOCAL\r\nCALL :find_dp0\r\n";

/**
 * For a script with `#!/usr/bin/env node`, as cmd-shim 7 writes it (npm 11, which Node 24
 * comes with): Node next to the shim, or on PATH, runs it.
 */
export function nodeShim(target: string): string {
  return (
    HEAD +
    "\r\n" +
    'IF EXIST "%dp0%\\node.exe" (\r\n' +
    '  SET "_prog=%dp0%\\node.exe"\r\n' +
    ") ELSE (\r\n" +
    '  SET "_prog=node"\r\n' +
    "  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n" +
    ")\r\n" +
    "\r\n" +
    "endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & " +
    `"%_prog%"  "%dp0%\\${target}" %*\r\n`
  );
}

/** The same as cmd-shim 9 writes it (npm 12): PATHEXT is set on the last line. */
export function nodeShimV9(target: string): string {
  return nodeShim(target)
    .replace("  SET PATHEXT=%PATHEXT:;.JS;=;%\r\n", "")
    .replace('& "%_prog%"', '& set PATHEXT=%PATHEXT:;.JS;=;% & "%_prog%"');
}

/** For a program (no `#!`), such as today's `bin/claude.exe`: the shim starts it directly. */
export function programShim(target: string): string {
  return `${HEAD}"%dp0%\\${target}"   %*\r\n`;
}
