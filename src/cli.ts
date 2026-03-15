#!/usr/bin/env node
/**
 * CLI entry point for the Flow Weaver Cloud tunnel.
 *
 * Usage:
 *   fw-cloud -k <apiKey> [-c <cloudUrl>] [-d <dir>]
 *   npx @synergenius/flow-weaver-pack-cloud -k <apiKey>
 */
import { startTunnel } from './tunnel.js';

function printUsage(): void {
  console.log(`
Flow Weaver Cloud Tunnel

Connect your local project to Flow Weaver Cloud Studio.
Cloud Studio gets real-time access to your files, parser,
compiler, and execution engine without uploading anything.

Usage:
  fw-cloud -k <apiKey> [options]

Options:
  -k, --key <key>      API key (fw_xxx) from Cloud Studio [required]
  -c, --cloud <url>    Cloud server URL [default: https://flowweaver.ai]
  -d, --dir <path>     Workspace directory [default: current directory]
  -h, --help           Show this help message
  -v, --version        Show version
`);
}

function parseArgs(args: string[]): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-k' || arg === '--key') {
      result.key = args[++i];
    } else if (arg === '-c' || arg === '--cloud') {
      result.cloud = args[++i];
    } else if (arg === '-d' || arg === '--dir') {
      result.dir = args[++i];
    } else if (arg === '-h' || arg === '--help') {
      result.help = 'true';
    } else if (arg === '-v' || arg === '--version') {
      result.version = 'true';
    }
  }
  return result;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.version) {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const dir = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(resolve(dir, '..', 'package.json'), 'utf-8'));
    console.log(pkg.version);
    return;
  }

  if (opts.help || !opts.key) {
    printUsage();
    if (!opts.key && !opts.help) {
      console.error('Error: --key is required\n');
      process.exit(1);
    }
    return;
  }

  await startTunnel({
    key: opts.key,
    cloud: opts.cloud,
    dir: opts.dir,
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
