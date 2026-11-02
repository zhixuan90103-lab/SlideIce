#!/usr/bin/env node
/**
 * Wire AdvancedHaptics into Capacitor iOS:
 * - cap add ios if missing
 * - copy Swift sources from plugins/native-haptics/
 * - Main.storyboard → BridgeViewController
 * - ensure pbxproj Sources / FileRef / group
 * - cap sync ios
 *
 * Usage: npm run ios:bootstrap
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const iosAppDir = path.join(root, 'ios', 'App', 'App');
const pluginDir = path.join(root, 'plugins', 'native-haptics');
const pbxPath = path.join(root, 'ios', 'App', 'App.xcodeproj', 'project.pbxproj');
const storyboardPath = path.join(iosAppDir, 'Base.lproj', 'Main.storyboard');
const infoPlistPath = path.join(iosAppDir, 'Info.plist');

const FILES = [
  {
    name: 'AdvancedHapticsPlugin.swift',
    fileRef: '84A1375B3B1524A100AB0001',
    buildFile: '84A1375C3B1524A100AB0001',
  },
  {
    name: 'BridgeViewController.swift',
    fileRef: '84A1375D3B1524A100AB0002',
    buildFile: '84A1375E3B1524A100AB0002',
  },
];

function run(cmd) {
  console.log(`> ${cmd}`);
  execSync(cmd, { cwd: root, stdio: 'inherit' });
}

function ensureIosProject() {
  if (!fs.existsSync(path.join(root, 'ios'))) {
    console.log('ios/ missing — running cap add ios…');
    run('npx cap add ios');
  }
  if (!fs.existsSync(iosAppDir)) {
    throw new Error(`iOS App directory not found: ${iosAppDir}`);
  }
}

function copyPluginSources() {
  for (const f of FILES) {
    const src = path.join(pluginDir, f.name);
    const dest = path.join(iosAppDir, f.name);
    if (!fs.existsSync(src)) throw new Error(`Missing plugin source: ${src}`);
    fs.copyFileSync(src, dest);
    console.log(`copied ${f.name}`);
  }
}

function patchSceneDelegate() {
  const scenePath = path.join(iosAppDir, 'SceneDelegate.swift');
  if (!fs.existsSync(scenePath)) {
    console.warn('SceneDelegate.swift not found, skip');
    return;
  }
  let src = fs.readFileSync(scenePath, 'utf8');
  const next = src.replace(
    /window\?\.rootViewController\s*=\s*CAPBridgeViewController\(\)/g,
    'window?.rootViewController = BridgeViewController()',
  );
  if (next === src) {
    if (src.includes('BridgeViewController()')) {
      console.log('SceneDelegate already uses BridgeViewController');
      return;
    }
    console.warn(
      'Could not patch SceneDelegate — set rootViewController = BridgeViewController()',
    );
    return;
  }
  fs.writeFileSync(scenePath, next);
  console.log('patched SceneDelegate → BridgeViewController()');
}

function patchStoryboard() {
  if (!fs.existsSync(storyboardPath)) {
    console.warn('Main.storyboard not found, skip storyboard patch');
    return;
  }
  let xml = fs.readFileSync(storyboardPath, 'utf8');

  xml = xml.replace(
    /<viewController([^>]*?)customClass="[^"]*"([^>]*)sceneMemberID="viewController"\s*\/>/,
    '<viewController$1customClass="BridgeViewController" customModule="App" sceneMemberID="viewController"/>',
  );

  xml = xml.replace(
    /customClass="BridgeViewController"(?:\s+customModule="[^"]*")+/g,
    'customClass="BridgeViewController" customModule="App"',
  );

  // Also accept MainViewController leftovers from other projects
  xml = xml.replace(
    /customClass="MainViewController"/g,
    'customClass="BridgeViewController"',
  );

  if (!xml.includes('customClass="BridgeViewController"')) {
    console.warn(
      'Could not patch Main.storyboard automatically — set customClass to BridgeViewController in Xcode.',
    );
    return;
  }

  fs.writeFileSync(storyboardPath, xml);
  console.log('patched Main.storyboard → BridgeViewController');
}

function patchInfoPlistPortrait() {
  if (!fs.existsSync(infoPlistPath)) return;
  let plist = fs.readFileSync(infoPlistPath, 'utf8');
  let changed = false;

  if (!plist.includes('UIRequiresFullScreen')) {
    plist = plist.replace(
      '</dict>\n</plist>',
      '\t<key>UIRequiresFullScreen</key>\n\t<true/>\n</dict>\n</plist>',
    );
    changed = true;
  }

  // Prefer portrait-only arrays if missing portrait key entirely — skip aggressive rewrite
  if (changed) {
    fs.writeFileSync(infoPlistPath, plist);
    console.log('patched Info.plist UIRequiresFullScreen');
  }
}

function ensureBuildFile(pbx, f) {
  const line = `\t\t${f.buildFile} /* ${f.name} in Sources */ = {isa = PBXBuildFile; fileRef = ${f.fileRef} /* ${f.name} */; };`;
  if (pbx.includes(`${f.buildFile} /* ${f.name} in Sources */`)) return pbx;
  return pbx.replace(
    '/* Begin PBXBuildFile section */\n',
    `/* Begin PBXBuildFile section */\n${line}\n`,
  );
}

function ensureFileRef(pbx, f) {
  const line = `\t\t${f.fileRef} /* ${f.name} */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = ${f.name}; sourceTree = "<group>"; };`;
  if (pbx.includes(`${f.fileRef} /* ${f.name} */ = {isa = PBXFileReference`)) return pbx;
  return pbx.replace(
    '/* Begin PBXFileReference section */\n',
    `/* Begin PBXFileReference section */\n${line}\n`,
  );
}

function ensureGroupChild(pbx, f) {
  const needle = `${f.fileRef} /* ${f.name} */,`;
  if (pbx.includes(needle)) return pbx;
  if (pbx.includes('504EC3071FED79650016851F /* AppDelegate.swift/*')) {
    // no-op guard
  }
  if (pbx.includes('504EC3071FED79650016851F /* AppDelegate.swift */,')) {
    return pbx.replace(
      '504EC3071FED79650016851F /* AppDelegate.swift */,',
      `504EC3071FED79650016851F /* AppDelegate.swift */,\n\t\t\t\t${needle}`,
    );
  }
  return pbx;
}

function ensureSourcesPhase(pbx, f) {
  const needle = `${f.buildFile} /* ${f.name} in Sources */,`;
  if (pbx.includes(needle)) return pbx;
  if (pbx.includes('504EC3081FED79650016851F /* AppDelegate.swift in Sources */,')) {
    return pbx.replace(
      '504EC3081FED79650016851F /* AppDelegate.swift in Sources */,',
      `${needle}\n\t\t\t\t504EC3081FED79650016851F /* AppDelegate.swift in Sources */,`,
    );
  }
  return pbx.replace(
    /(504EC3001FED79650016851F \/\* Sources \*\/ = \{\s*isa = PBXSourcesBuildPhase;[\s\S]*?files = \(\n)/,
    `$1\t\t\t\t${needle}\n`,
  );
}

function patchPbxproj() {
  if (!fs.existsSync(pbxPath)) throw new Error(`Missing ${pbxPath}`);
  let pbx = fs.readFileSync(pbxPath, 'utf8');

  pbx = pbx.replace(
    /504EC3081FED79650016851F \/\* AppDelegate\.swift in Sources \*\/ = \{isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F \/\* AppDelegate\.swift \*\/[\s\S]*?; \};/,
    '504EC3081FED79650016851F /* AppDelegate.swift in Sources */ = {isa = PBXBuildFile; fileRef = 504EC3071FED79650016851F /* AppDelegate.swift */; };',
  );

  for (const f of FILES) {
    pbx = ensureBuildFile(pbx, f);
    pbx = ensureFileRef(pbx, f);
    pbx = ensureGroupChild(pbx, f);
    pbx = ensureSourcesPhase(pbx, f);
    console.log(`pbxproj ensured for ${f.name}`);
  }

  fs.writeFileSync(pbxPath, pbx);
}

function main() {
  if (!fs.existsSync(path.join(root, 'node_modules', '@capacitor', 'cli'))) {
    run('npm install');
  }
  if (!fs.existsSync(path.join(root, 'dist', 'index.html'))) {
    run('npm run build');
  }
  ensureIosProject();
  copyPluginSources();
  patchStoryboard();
  patchSceneDelegate();
  patchInfoPlistPortrait();
  patchPbxproj();
  run('npx cap sync ios');
  console.log('\nDone. Next:');
  console.log('  1) npm run cap:open');
  console.log('  2) Xcode → Signing & Capabilities → Team');
  console.log('  3) Select iPhone → Run');
  console.log('  4) Change appId in capacitor.config.ts before shipping');
}

main();
