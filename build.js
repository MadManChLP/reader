#!/usr/bin/env node
/**
 * Reader - Cross-platform Build Script
 *
 * Usage:
 *   node build.js          - Build release version
 *   node build.js --debug  - Build debug version
 *   node build.js --help   - Show help
 */

import { execSync, spawn } from 'child_process';
import { existsSync } from 'fs';
import { platform } from 'os';

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logInfo(message) {
  log(`[INFO] ${message}`, 'cyan');
}

function logSuccess(message) {
  log(`[OK] ${message}`, 'green');
}

function logError(message) {
  log(`[ERROR] ${message}`, 'red');
}

function logWarning(message) {
  log(`[WARN] ${message}`, 'yellow');
}

function checkCommand(cmd) {
  try {
    execSync(`${platform() === 'win32' ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function getVersion(cmd) {
  try {
    return execSync(`${cmd} --version`, { encoding: 'utf8' }).trim().split('\n')[0];
  } catch {
    return 'unknown';
  }
}

function runCommand(command, args = []) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      stdio: 'inherit',
      shell: true
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with code ${code}`));
      }
    });

    proc.on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const isDebug = args.includes('--debug');
  const showHelp = args.includes('--help') || args.includes('-h');

  if (showHelp) {
    console.log(`
Reader - Build Script

Usage:
  node build.js          Build release version
  node build.js --debug  Build debug version (faster, larger binary)
  node build.js --help   Show this help message

Prerequisites:
  - Node.js (v18 or later recommended)
  - Rust (install from https://rustup.rs/)
  - Platform-specific dependencies:

    Windows:
      - WebView2 (usually pre-installed on Windows 10/11)

    Linux:
      - webkit2gtk, gtk3, libappindicator
      Ubuntu/Debian: sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev

    macOS:
      - Xcode Command Line Tools: xcode-select --install
`);
    process.exit(0);
  }

  console.log('');
  log('========================================', 'blue');
  log('  Reader - Build Script', 'blue');
  log('========================================', 'blue');
  console.log('');

  const currentPlatform = platform();
  logInfo(`Platform: ${currentPlatform}`);
  logInfo(`Build type: ${isDebug ? 'Debug' : 'Release'}`);
  console.log('');

  // Check dependencies
  logInfo('Checking dependencies...');

  if (!checkCommand('node')) {
    logError('Node.js is not installed');
    process.exit(1);
  }
  logSuccess(`Node.js: ${getVersion('node')}`);

  if (!checkCommand('npm')) {
    logError('npm is not installed');
    process.exit(1);
  }
  logSuccess(`npm: ${getVersion('npm')}`);

  if (!checkCommand('rustc')) {
    logError('Rust is not installed');
    logInfo('Install from: https://rustup.rs/');
    process.exit(1);
  }
  logSuccess(`Rust: ${getVersion('rustc')}`);

  if (!checkCommand('cargo')) {
    logError('Cargo is not installed');
    process.exit(1);
  }
  logSuccess(`Cargo: ${getVersion('cargo')}`);

  console.log('');

  // Install npm dependencies if needed
  if (!existsSync('node_modules')) {
    logInfo('Installing npm dependencies...');
    try {
      await runCommand('npm', ['install']);
      logSuccess('Dependencies installed');
    } catch (error) {
      logError('Failed to install dependencies');
      process.exit(1);
    }
  } else {
    logInfo('node_modules exists, skipping npm install');
  }

  console.log('');

  // Build
  logInfo(`Building Tauri application (${isDebug ? 'debug' : 'release'})...`);
  logInfo('This may take several minutes on first build...');
  console.log('');

  try {
    const buildArgs = isDebug ? ['run', 'tauri', 'build', '--', '--debug'] : ['run', 'tauri:build'];
    await runCommand('npm', buildArgs);
  } catch (error) {
    logError('Build failed');
    process.exit(1);
  }

  console.log('');
  log('========================================', 'green');
  log('  Build completed successfully!', 'green');
  log('========================================', 'green');
  console.log('');

  logInfo('Output location:');
  if (isDebug) {
    console.log('  src-tauri/target/debug/');
  } else {
    console.log('  src-tauri/target/release/');
    console.log('');
    logInfo('Installer packages:');

    if (currentPlatform === 'win32') {
      console.log('  src-tauri/target/release/bundle/msi/   (MSI installer)');
      console.log('  src-tauri/target/release/bundle/nsis/  (NSIS installer)');
    } else if (currentPlatform === 'darwin') {
      console.log('  src-tauri/target/release/bundle/dmg/   (DMG image)');
      console.log('  src-tauri/target/release/bundle/macos/ (App bundle)');
    } else {
      console.log('  src-tauri/target/release/bundle/deb/      (Debian package)');
      console.log('  src-tauri/target/release/bundle/appimage/ (AppImage)');
    }
  }
  console.log('');
}

main().catch((error) => {
  logError(error.message);
  process.exit(1);
});
