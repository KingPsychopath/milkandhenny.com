import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";

const STORE_SERVICE = "milkandhenny.com CLI admin";
const MISSING_ITEM_EXIT_CODE = 44;

type CommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function credentialAccount(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function runCommand(command: string, args: string[], input?: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once("error", (error) => {
      reject(new Error(`Unable to use the ${command} credential store: ${error.message}`));
    });
    child.once("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });

    if (input !== undefined) child.stdin.write(input);
    child.stdin.end();
  });
}

function commandError(action: string, result: CommandResult): Error {
  const detail = result.stderr.trim();
  return new Error(
    detail ? `Credential store ${action} failed: ${detail}` : `Credential store ${action} failed.`,
  );
}

function shellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function windowsTokenPath(baseUrl: string): string {
  const root = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const accountHash = createHash("sha256").update(credentialAccount(baseUrl)).digest("hex");
  return path.join(root, "milkandhenny", `cli-admin-${accountHash}.dat`);
}

async function readMacOS(baseUrl: string): Promise<string | null> {
  const result = await runCommand("/usr/bin/security", [
    "find-generic-password",
    "-a",
    credentialAccount(baseUrl),
    "-s",
    STORE_SERVICE,
    "-w",
  ]);
  if (result.code === MISSING_ITEM_EXIT_CODE) return null;
  if (result.code !== 0) throw commandError("read", result);
  return result.stdout.trim() || null;
}

async function writeMacOS(baseUrl: string, token: string): Promise<void> {
  const result = await runCommand(
    "/usr/bin/security",
    [
      "add-generic-password",
      "-U",
      "-a",
      credentialAccount(baseUrl),
      "-s",
      STORE_SERVICE,
      "-w",
      token,
    ],
  );
  if (result.code !== 0) throw commandError("write", result);
}

async function deleteMacOS(baseUrl: string): Promise<boolean> {
  const result = await runCommand("/usr/bin/security", [
    "delete-generic-password",
    "-a",
    credentialAccount(baseUrl),
    "-s",
    STORE_SERVICE,
  ]);
  if (result.code === MISSING_ITEM_EXIT_CODE) return false;
  if (result.code !== 0) throw commandError("delete", result);
  return true;
}

async function readLinux(baseUrl: string): Promise<string | null> {
  const result = await runCommand("secret-tool", [
    "lookup",
    "service",
    STORE_SERVICE,
    "account",
    credentialAccount(baseUrl),
  ]);
  if (result.code !== 0 && !result.stderr.trim()) return null;
  if (result.code !== 0) throw commandError("read", result);
  return result.stdout.trim() || null;
}

async function writeLinux(baseUrl: string, token: string): Promise<void> {
  const result = await runCommand(
    "secret-tool",
    [
      "store",
      "--label",
      STORE_SERVICE,
      "service",
      STORE_SERVICE,
      "account",
      credentialAccount(baseUrl),
    ],
    `${token}\n`,
  );
  if (result.code !== 0) throw commandError("write", result);
}

async function deleteLinux(baseUrl: string): Promise<boolean> {
  const result = await runCommand("secret-tool", [
    "clear",
    "service",
    STORE_SERVICE,
    "account",
    credentialAccount(baseUrl),
  ]);
  if (result.code !== 0 && !result.stderr.trim()) return false;
  if (result.code !== 0) throw commandError("delete", result);
  return true;
}

function runWindowsPowerShell(script: string, input?: string): Promise<CommandResult> {
  return runCommand(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    input,
  );
}

async function readWindows(baseUrl: string): Promise<string | null> {
  const file = shellLiteral(windowsTokenPath(baseUrl));
  const result = await runWindowsPowerShell(`
    $ErrorActionPreference = 'Stop'
    $file = ${file}
    if (-not (Test-Path -LiteralPath $file)) { exit ${MISSING_ITEM_EXIT_CODE} }
    $protected = [Convert]::FromBase64String([IO.File]::ReadAllText($file))
    $plain = [Security.Cryptography.ProtectedData]::Unprotect(
      $protected,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))
  `);
  if (result.code === MISSING_ITEM_EXIT_CODE) return null;
  if (result.code !== 0) throw commandError("read", result);
  return result.stdout.trim() || null;
}

async function writeWindows(baseUrl: string, token: string): Promise<void> {
  const file = shellLiteral(windowsTokenPath(baseUrl));
  const result = await runWindowsPowerShell(
    `
    $ErrorActionPreference = 'Stop'
    $file = ${file}
    $directory = [IO.Path]::GetDirectoryName($file)
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $plain = [Text.Encoding]::UTF8.GetBytes(([Console]::In.ReadToEnd()).Trim())
    $protected = [Security.Cryptography.ProtectedData]::Protect(
      $plain,
      $null,
      [Security.Cryptography.DataProtectionScope]::CurrentUser
    )
    [IO.File]::WriteAllText($file, [Convert]::ToBase64String($protected), [Text.Encoding]::ASCII)
  `,
    `${token}\n`,
  );
  if (result.code !== 0) throw commandError("write", result);
}

async function deleteWindows(baseUrl: string): Promise<boolean> {
  const file = shellLiteral(windowsTokenPath(baseUrl));
  const result = await runWindowsPowerShell(`
    $ErrorActionPreference = 'Stop'
    $file = ${file}
    if (-not (Test-Path -LiteralPath $file)) { exit ${MISSING_ITEM_EXIT_CODE} }
    Remove-Item -LiteralPath $file -Force
  `);
  if (result.code === MISSING_ITEM_EXIT_CODE) return false;
  if (result.code !== 0) throw commandError("delete", result);
  return true;
}

export async function readCliAdminToken(baseUrl: string): Promise<string | null> {
  if (process.platform === "darwin") return readMacOS(baseUrl);
  if (process.platform === "linux") return readLinux(baseUrl);
  if (process.platform === "win32") return readWindows(baseUrl);
  throw new Error("CLI admin sessions are not supported on this operating system.");
}

export async function writeCliAdminToken(baseUrl: string, token: string): Promise<void> {
  if (process.platform === "darwin") return writeMacOS(baseUrl, token);
  if (process.platform === "linux") return writeLinux(baseUrl, token);
  if (process.platform === "win32") return writeWindows(baseUrl, token);
  throw new Error("CLI admin sessions are not supported on this operating system.");
}

export async function deleteCliAdminToken(baseUrl: string): Promise<boolean> {
  if (process.platform === "darwin") return deleteMacOS(baseUrl);
  if (process.platform === "linux") return deleteLinux(baseUrl);
  if (process.platform === "win32") return deleteWindows(baseUrl);
  throw new Error("CLI admin sessions are not supported on this operating system.");
}

export function cliCredentialStoreLabel(): string {
  if (process.platform === "darwin") return "macOS Keychain";
  if (process.platform === "linux") return "Linux Secret Service";
  if (process.platform === "win32") return "Windows user-protected storage";
  return "OS credential store";
}
