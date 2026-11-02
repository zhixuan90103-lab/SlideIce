import Capacitor
import CoreHaptics
import UIKit

@objc(AdvancedHapticsPlugin)
public class AdvancedHapticsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AdvancedHapticsPlugin"
    public let jsName = "AdvancedHaptics"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "impact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "notification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "selection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "playPattern", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stackImpact", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startContinuousHaptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopContinuousHaptic", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKeepAwake", returnType: CAPPluginReturnPromise),
    ]

    private var engine: CHHapticEngine?
    private var continuousPlayer: CHHapticAdvancedPatternPlayer?
    private var isEngineRunning = false

    override public func load() {
        initEngine()
    }

    // MARK: - CHHapticEngine

    private func initEngine() {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { return }
        do {
            engine = try CHHapticEngine()
            engine?.playsHapticsOnly = true
            engine?.isAutoShutdownEnabled = false
            engine?.resetHandler = { [weak self] in
                self?.isEngineRunning = false
                self?.startEngineIfNeededQuietly()
            }
            engine?.stoppedHandler = { [weak self] _ in
                self?.isEngineRunning = false
            }
            startEngineIfNeededQuietly()
        } catch {
            debugLog("Engine init failed: \(error)")
        }
    }

    private func debugLog(_ message: String) {
        _ = message
    }

    // MARK: - impact

    @objc func impact(_ call: CAPPluginCall) {
        let style = call.getString("style") ?? "medium"
        DispatchQueue.main.async {
            let feedbackStyle: UIImpactFeedbackGenerator.FeedbackStyle
            switch style {
            case "light":  feedbackStyle = .light
            case "heavy":  feedbackStyle = .heavy
            case "soft":   feedbackStyle = .soft
            case "rigid":  feedbackStyle = .rigid
            default:       feedbackStyle = .medium
            }
            let generator = UIImpactFeedbackGenerator(style: feedbackStyle)
            generator.prepare()
            generator.impactOccurred()
            call.resolve()
        }
    }

    // MARK: - notification

    @objc func notification(_ call: CAPPluginCall) {
        let type = call.getString("type") ?? "success"
        DispatchQueue.main.async {
            let feedbackType: UINotificationFeedbackGenerator.FeedbackType
            switch type {
            case "warning": feedbackType = .warning
            case "error":   feedbackType = .error
            default:        feedbackType = .success
            }
            let generator = UINotificationFeedbackGenerator()
            generator.prepare()
            generator.notificationOccurred(feedbackType)
            call.resolve()
        }
    }

    // MARK: - selection

    @objc func selection(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let generator = UISelectionFeedbackGenerator()
            generator.prepare()
            generator.selectionChanged()
            call.resolve()
        }
    }

    // MARK: - playPattern

    private func ensureEngineRunning() throws {
        if engine == nil {
            initEngine()
        }
        guard engine != nil else {
            throw NSError(domain: "AdvancedHaptics", code: -1, userInfo: [NSLocalizedDescriptionKey: "Engine not initialized"])
        }
        try startEngineIfNeeded()
    }

    private func startEngineIfNeeded() throws {
        guard !isEngineRunning else { return }
        guard let engine = engine else {
            throw NSError(domain: "AdvancedHaptics", code: -1, userInfo: [NSLocalizedDescriptionKey: "Engine not initialized"])
        }
        try engine.start()
        isEngineRunning = true
    }

    private func startEngineIfNeededQuietly() {
        do {
            try startEngineIfNeeded()
        } catch {
            debugLog("Engine start failed: \(error)")
        }
    }

    private func playTransient(intensity: Float, sharpness: Float) throws {
        try ensureEngineRunning()
        guard let engine = engine else {
            throw NSError(domain: "AdvancedHaptics", code: -1, userInfo: [NSLocalizedDescriptionKey: "Engine not initialized"])
        }
        let event = CHHapticEvent(
            eventType: .hapticTransient,
            parameters: [
                CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
            ],
            relativeTime: 0
        )
        let pattern = try CHHapticPattern(events: [event], parameters: [])
        let player = try engine.makePlayer(with: pattern)
        try player.start(atTime: CHHapticTimeImmediate)
    }

    @objc func playPattern(_ call: CAPPluginCall) {
        guard let events = call.getArray("events") as? [JSObject] else {
            call.reject("Missing 'events' array")
            return
        }
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            call.reject("Haptics not supported on this device")
            return
        }

        do {
            try ensureEngineRunning()
            
            var hapticEvents: [CHHapticEvent] = []
            for event in events {
                let type = event["type"] as? String ?? "transient"
                let time = event["relativeTime"] as? Double ?? event["time"] as? Double ?? 0
                let duration = event["duration"] as? Double ?? 0.1
                let intensity = (event["intensity"] as? Double).map { Float($0) } ?? 0.5
                let sharpness = (event["sharpness"] as? Double).map { Float($0) } ?? 0.5

                var eventParams: [CHHapticEventParameter] = [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
                ]

                // Mapping optional ADSR parameters from JS
                let adsrMapping: [String: CHHapticEvent.ParameterID] = [
                    "attackTime": .attackTime,
                    "decayTime": .decayTime,
                    "releaseTime": .releaseTime
                ]

                for (key, id) in adsrMapping {
                    if let val = event[key] as? Double {
                        eventParams.append(CHHapticEventParameter(parameterID: id, value: Float(val)))
                    }
                }

                let eventType: CHHapticEvent.EventType = (type == "continuous") ? .hapticContinuous : .hapticTransient
                hapticEvents.append(CHHapticEvent(eventType: eventType, parameters: eventParams, relativeTime: time, duration: duration))
            }

            var hapticCurves: [CHHapticParameterCurve] = []
            if let curves = call.getArray("parameterCurves") as? [JSObject] {
                for curve in curves {
                    let paramIDStr = curve["parameterID"] as? String ?? "hapticIntensity"
                    let paramID: CHHapticDynamicParameter.ID = (paramIDStr == "hapticSharpness") ? .hapticSharpnessControl : .hapticIntensityControl
                    let relativeTime = curve["relativeTime"] as? Double ?? 0
                    
                    guard let jspoints = curve["controlPoints"] as? [JSObject] ?? curve["points"] as? [JSObject] else { continue }
                    var points: [CHHapticParameterCurve.ControlPoint] = []
                    for pt in jspoints {
                        let t = pt["relativeTime"] as? Double ?? pt["time"] as? Double ?? 0
                        let v = (pt["parameterValue"] as? Double ?? pt["value"] as? Double).map { Float($0) } ?? 0.5
                        points.append(CHHapticParameterCurve.ControlPoint(relativeTime: t, value: v))
                    }
                    
                    hapticCurves.append(CHHapticParameterCurve(parameterID: paramID, controlPoints: points, relativeTime: relativeTime))
                }
            }

            let pattern = try CHHapticPattern(events: hapticEvents, parameterCurves: hapticCurves)
            let player = try engine?.makePlayer(with: pattern)
            try player?.start(atTime: CHHapticTimeImmediate)
            call.resolve()
        } catch {
            call.reject("Failed to play pattern: \(error.localizedDescription)")
        }
    }

    // MARK: - stackImpact

    @objc func stackImpact(_ call: CAPPluginCall) {
        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            call.resolve()
            return
        }

        let intensity = call.getFloat("intensity") ?? 0.25
        let sharpness = call.getFloat("sharpness") ?? 0.15

        do {
            try playTransient(intensity: intensity, sharpness: sharpness)
            call.resolve()
        } catch {
            call.reject("Failed to play stack impact: \(error.localizedDescription)")
        }
    }

    // MARK: - startContinuousHaptic

    @objc func startContinuousHaptic(_ call: CAPPluginCall) {
        let intensity = call.getFloat("intensity") ?? 0.25
        let sharpness = call.getFloat("sharpness") ?? 0.3
        let duration = call.getDouble("duration") ?? 30.0

        guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else {
            call.reject("Haptics not supported")
            return
        }

        do {
            try ensureEngineRunning()

            let event = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: intensity),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness)
                ],
                relativeTime: 0,
                duration: duration
            )
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let player = try engine?.makeAdvancedPlayer(with: pattern)
            try player?.start(atTime: CHHapticTimeImmediate)
            continuousPlayer = player
            call.resolve()
        } catch {
            call.reject("Failed to start continuous haptic: \(error.localizedDescription)")
        }
    }

    // MARK: - setKeepAwake
    // 游戏期间禁用系统自动锁屏 / 屏幕休眠
    // enabled=true → isIdleTimerDisabled = true（屏幕常亮）
    // enabled=false → isIdleTimerDisabled = false（恢复系统行为）
    @objc func setKeepAwake(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = enabled
            call.resolve(["enabled": enabled])
        }
    }

    // MARK: - stopContinuousHaptic

    @objc func stopContinuousHaptic(_ call: CAPPluginCall) {
        if let player = continuousPlayer {
            do {
                // Fade out intensity over ~50ms instead of abrupt stop
                let fadeParam = CHHapticDynamicParameter(
                    parameterID: .hapticIntensityControl, value: 0, relativeTime: 0)
                try player.sendParameters([fadeParam], atTime: CHHapticTimeImmediate)
                // Delay actual stop to let the fade complete
                let capturedPlayer = player
                self.continuousPlayer = nil
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                    do {
                        try capturedPlayer.stop(atTime: CHHapticTimeImmediate)
                    } catch {
                        self.debugLog("delayed stop error: \(error)")
                    }
                }
            } catch {
                debugLog("stopContinuousHaptic error: \(error)")
                try? player.stop(atTime: CHHapticTimeImmediate)
                self.continuousPlayer = nil
            }
        }
        call.resolve()
    }
}
