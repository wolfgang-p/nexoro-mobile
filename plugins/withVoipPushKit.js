/**
 * withVoipPushKit — Expo config plugin (iOS only).
 *
 * Wires PushKit / VoIP push into the generated Swift AppDelegate so that
 * `react-native-voip-push-notification` can deliver an incoming-call push that
 * wakes the app and rings CallKit EVEN WHEN THE APP IS FULLY KILLED. Regular
 * APNs (Expo push) only wakes a backgrounded app; PushKit is the only iOS
 * mechanism that launches a terminated app for a call.
 *
 * This plugin is deliberately ADDITIVE and IDEMPOTENT:
 *   • It only ever INSERTS code, guarded by unique marker comments, so running
 *     `expo prebuild` (or `--clean`) repeatedly never duplicates or corrupts.
 *   • It touches ONLY the PushKit wiring. Every existing AppDelegate method
 *     (launch, linking, universal links) is left byte-for-byte intact.
 *   • If any expected anchor is missing (e.g. Expo changes the AppDelegate
 *     template), it logs a warning and NO-OPS rather than producing broken
 *     native code — the app still builds, just without killed-app VoIP.
 *
 * The CallKit framework, `voip` UIBackgroundMode, and header search paths are
 * handled by `@config-plugins/react-native-callkeep`; this plugin is only the
 * PushKit registry glue that library needs but Expo can't add automatically.
 *
 * JS side: see lib/voipPush.ts — it registers the VoIP token as `voip_token`
 * and forwards the incoming-call payload to CallKit + the call manager.
 */

const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'KORO_VOIP_PUSHKIT'; // idempotency guard

// ── 1. Bridging header: expose the ObjC manager to Swift ────────────────────
function withBridgingHeaderImport(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const projectName = config.modRequest.projectName;
      const iosRoot = config.modRequest.platformProjectRoot;
      const headerPath = path.join(iosRoot, projectName, `${projectName}-Bridging-Header.h`);

      if (!fs.existsSync(headerPath)) {
        console.warn(`[withVoipPushKit] bridging header not found at ${headerPath} — skipping import (killed-app VoIP disabled).`);
        return config;
      }
      let contents = fs.readFileSync(headerPath, 'utf8');
      // Expose BOTH the VoIP push manager AND RNCallKeep to Swift. RNCallKeep is
      // needed so the AppDelegate can report the incoming call to CallKit
      // NATIVELY and synchronously inside didReceiveIncomingPush — iOS 13+ kills
      // the app if the CallKit call isn't reported before the push completion
      // runs, and on a cold start the JS bundle loads far too late to do it.
      const imports = [
        '#import "RNVoipPushNotificationManager.h"',
        '#import "RNCallKeep.h"',
      ];
      let changed = false;
      for (const importLine of imports) {
        if (!contents.includes(importLine)) {
          contents = `${contents.trimEnd()}\n\n// ${MARKER}: expose ${importLine.includes('CallKeep') ? 'CallKeep' : 'the VoIP push manager'} to Swift\n${importLine}\n`;
          changed = true;
        }
      }
      if (changed) fs.writeFileSync(headerPath, contents);
      return config;
    },
  ]);
}

// ── 2. AppDelegate.swift: import PushKit, register, add delegate methods ─────
function withAppDelegatePushKit(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const projectName = config.modRequest.projectName;
      const iosRoot = config.modRequest.platformProjectRoot;
      const appDelegatePath = path.join(iosRoot, projectName, 'AppDelegate.swift');

      if (!fs.existsSync(appDelegatePath)) {
        console.warn('[withVoipPushKit] AppDelegate.swift not found — skipping (killed-app VoIP disabled).');
        return config;
      }
      let src = fs.readFileSync(appDelegatePath, 'utf8');

      // Already patched → nothing to do (idempotent).
      if (src.includes(`${MARKER}_REGISTER`)) {
        return config;
      }

      // 2a. `import PushKit` right after `import Expo`.
      if (!src.includes('import PushKit')) {
        src = src.replace(
          /import Expo\n/,
          `import Expo\nimport PushKit  // ${MARKER}\n`,
        );
      }

      // 2b. Kick off VoIP registration via the LIBRARY's own entry point, just
      //     before the closing `return super…` of didFinishLaunchingWithOptions.
      //     IMPORTANT: we call `RNVoipPushNotificationManager.voipRegistration()`
      //     — NOT a hand-rolled PKPushRegistry. The library creates the
      //     PKPushRegistry ITSELF and sets its delegate to the AppDelegate, then
      //     invokes the delegate selectors below. Rolling our own registry here
      //     competed with the library's and meant `voipRegistration` never ran,
      //     so the register event never fired and no token reached JS.
      const launchAnchor = 'return super.application(application, didFinishLaunchingWithOptions: launchOptions)';
      if (src.includes(launchAnchor)) {
        const registerBlock =
          `// ${MARKER}_REGISTER: let the VoIP push library register PushKit\n` +
          `    NSLog("[NexoroVoIP] calling voipRegistration()")\n` +
          `    RNVoipPushNotificationManager.voipRegistration()\n\n` +
          // CRITICAL for killed-app ringing: set up RNCallKeep NATIVELY at launch.
          // On a cold start triggered by a VoIP push, the JS bundle hasn't run yet,
          // so configureCallKit()/lib.setup() in JS never executed — which means the
          // CXProvider has no delegate and reportNewIncomingCall() in
          // didReceiveIncomingPush is silently dropped (rings NOTHING). Calling
          // RNCallKeep.setup here builds the provider AND wires its delegate up front,
          // so CallKit is fully armed before the first push arrives. setup is
          // guarded by isSetupNatively, so the later JS setup() becomes a no-op —
          // no double init.\n` +
          `    RNCallKeep.setup([\n` +
          `      "appName": "Nexoro",\n` +
          `      "supportsVideo": true,\n` +
          `      "maximumCallGroups": "1",\n` +
          `      "maximumCallsPerCallGroup": "1",\n` +
          `    ])\n\n` +
          `    `;
        src = src.replace(launchAnchor, `${registerBlock}${launchAnchor}`);
      } else {
        console.warn('[withVoipPushKit] didFinishLaunching anchor not found — VoIP registration skipped.');
        return config;
      }

      // 2c. Append the PKPushRegistryDelegate methods on AppDelegate. The library
      //     sets the registry's delegate to the AppDelegate, so iOS calls THESE.
      //     PKPushRegistryDelegate is an @objc protocol, so conforming with the
      //     exact Swift signatures below auto-synthesises the correct ObjC
      //     selectors — no manual @objc(...) needed. Each forwards to the
      //     library's class methods; the Swift-bridged names come from Apple's
      //     ObjC→Swift translation of the header:
      //       didUpdatePushCredentials:forType:          → didUpdate(_:forType:)
      //       didReceiveIncomingPushWithPayload:forType: → didReceiveIncomingPush(with:forType:)
      //   (The Swift importer folds "WithPayload" down to the label "with:" here,
      //    since the payload noun restates the argument — verified by the Xcode
      //    compiler: it rejects withPayload: and expects with:.)
      const ext =
`

// ${MARKER}_DELEGATE: PushKit / VoIP push handling.
// The RNVoipPushNotification library sets this AppDelegate as the PKPushRegistry
// delegate, so iOS calls these methods. We forward to the library's class
// methods, which re-emit to JS (see lib/voipPush.ts). Pure glue — no logic here.
extension AppDelegate: PKPushRegistryDelegate {
  public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
    // Native log — proves iOS delivered a VoIP token to us (independent of JS).
    let tokenHex = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
    NSLog("[NexoroVoIP] didUpdatePushCredentials — VoIP token length=\\(pushCredentials.token.count) hex-prefix=\\(tokenHex.prefix(12))")
    RNVoipPushNotificationManager.didUpdate(pushCredentials, forType: type.rawValue)
  }

  public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
    // Token invalidated (rare). Nothing to persist — JS re-registers next launch.
  }

  public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
    // iOS 13+ MANDATES that a CallKit incoming call be reported SYNCHRONOUSLY,
    // NATIVELY, inside this method — before the completion runs — or the OS
    // terminates the app and throttles/blocks future VoIP pushes ("Nexoro ist
    // abgestürzt" on a killed-app call). On a cold start the JS bundle loads far
    // too late to do this, so we CANNOT rely on JS to report the call.
    //
    // We therefore report the call to CallKit RIGHT HERE via RNCallKeep's native
    // class method, deriving a STABLE CallKit UUID from the call_id so the JS
    // side (which keys CallKit by the same call_id — see lib/callKit.ts) maps
    // answer/end events back to the same call. We still forward the payload to JS
    // so the app can hydrate the call and bring up WebRTC; RNCallKeep de-dupes a
    // second report of the same UUID, so JS calling displayIncomingCall again is
    // harmless.
    let dict = payload.dictionaryPayload
    let callId = (dict["call_id"] as? String) ?? UUID().uuidString
    let uuid = NexoroVoipUUID.stableUUID(from: callId)
    let callerName = (dict["from_name"] as? String) ?? "Nexoro"
    let hasVideo = (dict["kind"] as? String) == "video"

    // Forward to JS FIRST so the RNVoipPushNotificationManager caches the event
    // and the JS pipeline (hydrate + WebRTC) starts as early as possible.
    RNVoipPushNotificationManager.didReceiveIncomingPush(with: payload, forType: type.rawValue)

    // Report to CallKit natively — THIS is what keeps iOS from killing us. The
    // completion is invoked by RNCallKeep once the call is reported, satisfying
    // the PushKit contract even if JS never finishes booting.
    RNCallKeep.reportNewIncomingCall(
      uuid,
      handle: callerName,
      handleType: "generic",
      hasVideo: hasVideo,
      localizedCallerName: callerName,
      supportsHolding: true,
      supportsDTMF: false,
      supportsGrouping: false,
      supportsUngrouping: false,
      fromPushKit: true,
      payload: dict as? [String: Any],
      withCompletionHandler: completion
    )
  }
}

// ${MARKER}_UUID: derive a STABLE CallKit UUID from our string call_id so the
// native PushKit report and the JS CallKit layer (lib/callKit.ts keys by call_id)
// agree on the same UUID. Deterministic: same call_id → same UUID every time.
enum NexoroVoipUUID {
  static func stableUUID(from callId: String) -> String {
    // If the call_id already IS a UUID, use it verbatim (upper-cased for CallKit).
    if let asUUID = UUID(uuidString: callId) { return asUUID.uuidString }
    // Otherwise hash the string into 16 bytes and format as a v4-ish UUID. We use
    // a simple FNV-1a over the utf8 bytes, expanded to 16 bytes — collision risk
    // is irrelevant for the tiny set of concurrent calls a device ever has.
    var bytes = [UInt8](repeating: 0, count: 16)
    var hash: UInt64 = 0xcbf29ce484222325
    let prime: UInt64 = 0x100000001b3
    var i = 0
    for b in callId.utf8 {
      hash = (hash ^ UInt64(b)) &* prime
      bytes[i % 16] = bytes[i % 16] ^ UInt8(truncatingIfNeeded: hash)
      i += 1
    }
    // Force RFC-4122 version (4) and variant bits so it's a well-formed UUID.
    bytes[6] = (bytes[6] & 0x0F) | 0x40
    bytes[8] = (bytes[8] & 0x3F) | 0x80
    let hex = bytes.map { String(format: "%02X", $0) }.joined()
    let s = Array(hex)
    return "\\(String(s[0..<8]))-\\(String(s[8..<12]))-\\(String(s[12..<16]))-\\(String(s[16..<20]))-\\(String(s[20..<32]))"
  }
}
`;
      src = `${src.trimEnd()}\n${ext}`;

      fs.writeFileSync(appDelegatePath, src);
      return config;
    },
  ]);
}

// ── 3. Ensure the VoIP background mode + aps-environment exist ───────────────
// (callkeep plugin already adds `voip` to UIBackgroundModes; this is a safety
// net so the plugin is self-sufficient even if plugin order changes.)
function withVoipBackgroundMode(config) {
  if (!config.ios) config.ios = {};
  if (!config.ios.infoPlist) config.ios.infoPlist = {};
  const modes = config.ios.infoPlist.UIBackgroundModes || [];
  if (!modes.includes('voip')) modes.push('voip');
  config.ios.infoPlist.UIBackgroundModes = modes;
  return config;
}

module.exports = function withVoipPushKit(config) {
  config = withVoipBackgroundMode(config);
  config = withBridgingHeaderImport(config);
  config = withAppDelegatePushKit(config);
  return config;
};
