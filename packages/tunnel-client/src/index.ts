#!/usr/bin/env node

import { TunnelClient } from './tunnel';

// ── CLI Argument Parser ──

interface CliArgs {
  server: string;
  token: string;
  port: number;
  localPort: number;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    server: 'wss://api.datadesng.com',
    token: '',
    port: 0,
    localPort: 0,
    help: false,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    switch (arg) {
      case '--server':
      case '-s':
        args.server = next || args.server;
        i++;
        break;
      case '--token':
      case '-t':
        args.token = next || '';
        i++;
        break;
      case '--port':
      case '-p':
        args.port = parseInt(next || '0', 10);
        i++;
        break;
      case '--local-port':
      case '-l':
        args.localPort = parseInt(next || '0', 10);
        i++;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
    }
  }

  if (!args.localPort) args.localPort = args.port;

  return args;
}

function printBanner(): void {
  console.log(`
  \x1b[36m╔══════════════════════════════════════╗
  ║     NUCLEUS TUNNEL CLIENT v0.1.0     ║
  ╚══════════════════════════════════════╝\x1b[0m
  `);
}

function printHelp(): void {
  printBanner();
  console.log(`  Forward a remote device port to your local machine.

  \x1b[33mUsage:\x1b[0m
    nucleus-tunnel --token <TOKEN> --port <PORT>

  \x1b[33mOptions:\x1b[0m
    --token, -t       Session token from the Nucleus Portal (required)
    --port, -p        Remote device port to forward (required)
    --local-port, -l  Local port to listen on (default: same as --port)
    --server, -s      WebSocket server URL (default: Nucleus Cloud)
    --help, -h        Show this help message

  \x1b[33mExamples:\x1b[0m
    nucleus-tunnel --token abc123... --port 502
    nucleus-tunnel -t abc123... -p 502 -l 1502
    nucleus-tunnel --token abc123... --port 2202

  \x1b[33mThen connect your tools to:\x1b[0m
    Modbus Poll  → localhost:502
    PCCU         → localhost:2202
    Any TCP tool → localhost:<local-port>
  `);
}

// ── Main ──

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.token) {
    printBanner();
    console.error('  \x1b[31mError:\x1b[0m --token is required');
    console.log('  Run with --help for usage information.\n');
    process.exit(1);
  }

  if (!args.port) {
    printBanner();
    console.error('  \x1b[31mError:\x1b[0m --port is required');
    console.log('  Run with --help for usage information.\n');
    process.exit(1);
  }

  printBanner();

  const client = new TunnelClient({
    serverUrl: args.server,
    sessionToken: args.token,
    remotePort: args.port,
    localPort: args.localPort,
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  \x1b[33mShutting down...\x1b[0m');
    client.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    client.close();
    process.exit(0);
  });

  try {
    await client.start();
  } catch (err) {
    console.error(`  \x1b[31mFatal error:\x1b[0m ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
