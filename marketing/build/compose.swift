// GameClaw advertisement compositor.
//
// Builds a finished MP4 from genuine screen recordings plus original motion graphics, using only
// what ships with macOS: AVFoundation for the timeline and export, Core Animation for titles and
// the brand mark. There is no ffmpeg on this machine and no stock footage is used.
//
//   compose <out.mp4> <W> <H> <mode>        mode = master | teaser
//
// Clips, titles and timings are declared in `plan()` below so the edit can be changed without
// touching the rendering code.

import Foundation
import AVFoundation
import CoreGraphics
import QuartzCore
import CoreText
import AppKit

let INK = CGColor(red: 0.035, green: 0.035, blue: 0.043, alpha: 1)      // #09090B
let LIME = CGColor(red: 0.80, green: 1.00, blue: 0.18, alpha: 1)        // #CCFF2E
let WHITE = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let MUTED = CGColor(red: 0.63, green: 0.63, blue: 0.67, alpha: 1)

let RAW = "/Users/isaacgyampoh/betting/marketing/raw"

struct Seg { let file: String; let start: Double; let dur: Double; let caption: String }

func plan(_ mode: String) -> [Seg] {
    // Starts are chosen from the recordings, not guessed: gc_match.mp4 opens on the results list
    // and the match detail only appears once the tap lands, at about 6.4s.
    if mode == "teaser" {
        return [
            Seg(file: "gc_results.mp4", start: 1.5, dur: 4.5, caption: "Every result. Every competition."),
            Seg(file: "gc_match.mp4",   start: 6.6, dur: 4.5, caption: "Form, stats, the full picture."),
            Seg(file: "gc_convert.mp4", start: 0.4, dur: 4.0, caption: "Move a slip between bookmakers."),
        ]
    }
    return [
        Seg(file: "gc_results.mp4", start: 0.3, dur: 11.7, caption: "Every result. Every competition."),
        Seg(file: "gc_match.mp4",   start: 6.4, dur:  5.7, caption: "Form, stats, the full picture."),
        Seg(file: "gc_convert.mp4", start: 0.2, dur:  7.8, caption: "Move a slip between bookmakers."),
        // Sits behind the closing card; its content is barely seen and needs no caption.
        Seg(file: "gc_results.mp4", start: 6.0, dur:  5.5, caption: ""),
    ]
}

// MARK: - the GameClaw mark, drawn from the app's own parametric geometry

func clawPath(size: CGFloat) -> CGPath {
    let slashes: [(r: CGFloat, from: CGFloat, to: CGFloat, w: CGFloat)] = [
        (1.032, -1.181, -0.463, 0.070),
        (1.202, -1.245, -0.390, 0.086),
        (1.372, -1.181, -0.463, 0.070),
    ]
    let ox = -0.35 * size, oy = 1.35 * size
    let path = CGMutablePath()
    let steps = 28
    for s in slashes {
        let radius = s.r * size, half = s.w * size * 0.5
        let span = abs(s.to - s.from)
        var outer: [CGPoint] = [], inner: [CGPoint] = []
        for i in 0...steps {
            let f = CGFloat(i) / CGFloat(steps)
            let a = s.from + (s.to - s.from) * f
            let along = min(max((a - s.from) / span, 0), 1)
            let w = half * sin(.pi * along)
            let dx = cos(a), dy = sin(a)
            outer.append(CGPoint(x: ox + dx * (radius + w), y: oy + dy * (radius + w)))
            inner.append(CGPoint(x: ox + dx * (radius - w), y: oy + dy * (radius - w)))
        }
        path.move(to: outer[0])
        for p in outer.dropFirst() { path.addLine(to: p) }
        for p in inner.reversed() { path.addLine(to: p) }
        path.closeSubpath()
    }
    return path
}

/// Centres the mark's drawn extent on `centre` — its origin sits outside the canvas, so centring
/// on the nominal square puts the shape in a corner.
func clawLayer(size: CGFloat, centre: CGPoint, colour: CGColor) -> CAShapeLayer {
    let p = clawPath(size: size)
    let b = p.boundingBox
    let t = CGAffineTransform(translationX: centre.x - b.midX, y: centre.y - b.midY)
    let moved = CGMutablePath()
    moved.addPath(p, transform: t)
    let l = CAShapeLayer()
    l.path = moved
    l.fillColor = colour
    return l
}

// MARK: - text

/// Text as a pre-rendered bitmap on a plain CALayer.
///
/// Not CATextLayer: it renders correctly offline (verified) but draws nothing inside
/// AVVideoCompositionCoreAnimationTool on this system, while CAShapeLayer in the same tree renders
/// fine. Rather than fight that, the string is drawn once into a CGImage with CoreText and handed
/// to a layer as `contents`, which the compositor does honour.
func textLayer(_ s: String, size: CGFloat, colour: CGColor, weight: CGFloat, frame: CGRect,
               align: CATextLayerAlignmentMode = .center) -> CALayer {
    let name = weight > 0.5 ? "HelveticaNeue-Bold" : "HelveticaNeue"
    let font = CTFontCreateWithName(name as CFString, size, nil)
    let scale: CGFloat = 2
    let w = Int(frame.width * scale), h = Int(frame.height * scale)

    let para = NSMutableParagraphStyle()
    para.alignment = .center
    para.lineBreakMode = .byWordWrapping
    let attrs: [NSAttributedString.Key: Any] = [
        .font: font,
        .foregroundColor: NSColor(cgColor: colour) ?? .white,
        .paragraphStyle: para,
    ]
    let attributed = NSAttributedString(string: s, attributes: attrs)

    guard let ctx = CGContext(data: nil, width: max(w, 1), height: max(h, 1), bitsPerComponent: 8,
                              bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else {
        return CALayer()
    }
    ctx.scaleBy(x: scale, y: scale)
    let gctx = NSGraphicsContext(cgContext: ctx, flipped: false)
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = gctx
    // Vertically centre the line(s) within the box.
    let bounds = attributed.boundingRect(with: CGSize(width: frame.width, height: .greatestFiniteMagnitude),
                                         options: [.usesLineFragmentOrigin])
    let y = (frame.height - bounds.height) / 2
    attributed.draw(with: CGRect(x: 0, y: y, width: frame.width, height: bounds.height),
                    options: [.usesLineFragmentOrigin])
    NSGraphicsContext.restoreGraphicsState()

    let layer = CALayer()
    layer.frame = frame
    layer.contents = ctx.makeImage()
    layer.contentsGravity = .resizeAspect
    return layer
}

/// `fadeOut: false` holds the layer at full opacity to the end — what a closing card needs. With
/// it fading out, the last frame of the film is the brand card dissolving back into app footage,
/// which is how the first export ended.
func fade(_ layer: CALayer, inAt: Double, outAt: Double, hold: Double = 0.45, fadeOut: Bool = true) {
    if ProcessInfo.processInfo.environment["NOFADE"] != nil { layer.opacity = 1; return }
    layer.opacity = 0
    let a = CAKeyframeAnimation(keyPath: "opacity")
    a.values = fadeOut ? [0, 1, 1, 0] : [0, 1, 1, 1]
    a.keyTimes = [0, NSNumber(value: hold / (outAt - inAt)), NSNumber(value: 1 - hold / (outAt - inAt)), 1]
    a.beginTime = inAt == 0 ? 1e-9 : inAt
    a.duration = outAt - inAt
    a.isRemovedOnCompletion = false
    a.fillMode = .both
    layer.add(a, forKey: "op")
}

// MARK: - build

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let W = CGFloat(Int(CommandLine.arguments[2])!)
let H = CGFloat(Int(CommandLine.arguments[3])!)
let mode = CommandLine.arguments[4]
// Type and brand elements are sized off the SHORT edge, or landscape renders them enormous.
let U = min(W, H)
let voicePath = CommandLine.arguments.count > 5 ? CommandLine.arguments[5] : ""

let segs = plan(mode)
let comp = AVMutableComposition()
let vTrack = comp.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!

var instructions: [AVMutableVideoCompositionInstruction] = []
var cursor = CMTime.zero

let sem = DispatchSemaphore(value: 0)
Task {
    do {
        for seg in segs {
            let asset = AVURLAsset(url: URL(fileURLWithPath: "\(RAW)/\(seg.file)"))
            guard let src = try await asset.loadTracks(withMediaType: .video).first else { continue }
            let range = CMTimeRange(start: CMTime(seconds: seg.start, preferredTimescale: 600),
                                    duration: CMTime(seconds: seg.dur, preferredTimescale: 600))
            try vTrack.insertTimeRange(range, of: src, at: cursor)

            let natural = try await src.load(.naturalSize)
            // Fit the phone recording inside the frame with margins, so it reads as a device shot
            // rather than a full-bleed screenshot.
            let targetH = H * (W > H ? 0.74 : (mode == "teaser" ? 0.68 : 0.72))
            let scale = targetH / natural.height
            let w = natural.width * scale
            let tx = (W - w) / 2
            let ty = (H - targetH) / 2

            let li = AVMutableVideoCompositionLayerInstruction(assetTrack: vTrack)
            li.setTransform(CGAffineTransform(scaleX: scale, y: scale)
                                .concatenating(CGAffineTransform(translationX: tx, y: ty)),
                            at: cursor)
            let inst = AVMutableVideoCompositionInstruction()
            inst.timeRange = CMTimeRange(start: cursor, duration: range.duration)
            inst.layerInstructions = [li]
            inst.backgroundColor = INK
            instructions.append(inst)
            cursor = cursor + range.duration
        }

        let total = CMTimeGetSeconds(cursor)

        // ---- overlay layers ----
        let parent = CALayer(); parent.frame = CGRect(x: 0, y: 0, width: W, height: H)
        parent.backgroundColor = INK
        let video = CALayer(); video.frame = parent.frame
        let overlay = CALayer(); overlay.frame = parent.frame
        parent.addSublayer(video); parent.addSublayer(overlay)

        // Opening card: a dark plate over the first clip, carrying the brand and the hook.
        let openDur = mode == "teaser" ? 1.8 : 3.2
        let plate = CALayer()
        plate.frame = parent.frame
        plate.backgroundColor = INK
        overlay.addSublayer(plate)
        fade(plate, inAt: 0, outAt: openDur, hold: 0.3)

        let mark = clawLayer(size: U * 0.22, centre: CGPoint(x: W / 2, y: H * 0.60), colour: LIME)
        overlay.addSublayer(mark); fade(mark, inAt: 0, outAt: openDur, hold: 0.3)

        let word = textLayer("GAMECLAW", size: U * 0.072, colour: WHITE, weight: 1,
                             frame: CGRect(x: 0, y: H * 0.455, width: W, height: U * 0.11))
        overlay.addSublayer(word); fade(word, inAt: 0, outAt: openDur, hold: 0.3)

        let hook = textLayer("Every match has a story.", size: U * 0.040, colour: MUTED, weight: 0,
                             frame: CGRect(x: W * 0.1, y: H * 0.40, width: W * 0.8, height: U * 0.12))
        overlay.addSublayer(hook); fade(hook, inAt: 0, outAt: openDur, hold: 0.3)

        // Captions, one per segment, sitting under the device.
        var t = 0.0
        for (i, seg) in segs.enumerated() {
            let from = max(t, i == 0 ? openDur : t) + 0.2
            let to = t + seg.dur - 0.2
            if to > from, !seg.caption.isEmpty {
                let cap = textLayer(seg.caption, size: U * 0.038, colour: WHITE, weight: 1,
                                    frame: CGRect(x: W * 0.06, y: H * 0.035, width: W * 0.88, height: U * 0.10))
                overlay.addSublayer(cap)
                fade(cap, inAt: from, outAt: to)
            }
            t += seg.dur
        }

        // Closing card.
        let endDur = mode == "teaser" ? 2.2 : 4.0
        let endFrom = total - endDur
        let endPlate = CALayer(); endPlate.frame = parent.frame; endPlate.backgroundColor = INK
        overlay.addSublayer(endPlate); fade(endPlate, inAt: endFrom, outAt: total, hold: 0.4, fadeOut: false)

        let endMark = clawLayer(size: U * 0.20, centre: CGPoint(x: W / 2, y: H * 0.605), colour: LIME)
        overlay.addSublayer(endMark); fade(endMark, inAt: endFrom, outAt: total, hold: 0.4, fadeOut: false)
        let endWord = textLayer("GAMECLAW", size: U * 0.066, colour: WHITE, weight: 1,
                                frame: CGRect(x: 0, y: H * 0.470, width: W, height: U * 0.10))
        overlay.addSublayer(endWord); fade(endWord, inAt: endFrom, outAt: total, hold: 0.4, fadeOut: false)
        let tag = textLayer("Follow the game. Own your matchday.", size: U * 0.038, colour: MUTED,
                            weight: 0, frame: CGRect(x: W * 0.08, y: H * 0.415, width: W * 0.84, height: U * 0.10))
        overlay.addSublayer(tag); fade(tag, inAt: endFrom, outAt: total, hold: 0.4, fadeOut: false)
        let site = textLayer("gameclaw.win", size: U * 0.036, colour: LIME, weight: 1,
                             frame: CGRect(x: 0, y: H * 0.355, width: W, height: U * 0.09))
        overlay.addSublayer(site); fade(site, inAt: endFrom, outAt: total, hold: 0.4, fadeOut: false)

        // ---- video composition ----
        let vc = AVMutableVideoComposition()
        vc.renderSize = CGSize(width: W, height: H)
        vc.frameDuration = CMTime(value: 1, timescale: 30)
        vc.instructions = instructions
        vc.animationTool = AVVideoCompositionCoreAnimationTool(
            postProcessingAsVideoLayer: video, in: parent)

        // ---- narration ----
        // A manifest of "start<TAB>file" lines rather than one continuous take, so each sentence
        // lands on the picture it describes and the SRT can be generated from the same numbers.
        if !voicePath.isEmpty, FileManager.default.fileExists(atPath: voicePath) {
            let aTrack = comp.addMutableTrack(withMediaType: .audio,
                                              preferredTrackID: kCMPersistentTrackID_Invalid)!
            let manifest = try String(contentsOfFile: voicePath, encoding: .utf8)
            for row in manifest.split(whereSeparator: \.isNewline) {
                let parts = row.split(separator: "\t")
                guard parts.count == 2, let at = Double(parts[0]) else { continue }
                let vo = AVURLAsset(url: URL(fileURLWithPath: String(parts[1])))
                guard let a = try await vo.loadTracks(withMediaType: .audio).first else { continue }
                let d = try await vo.load(.duration)
                try aTrack.insertTimeRange(CMTimeRange(start: .zero, duration: d), of: a,
                                           at: CMTime(seconds: at, preferredTimescale: 600))
            }
        }

        // ---- export ----
        try? FileManager.default.removeItem(at: out)
        guard let ex = AVAssetExportSession(asset: comp, presetName: AVAssetExportPreset1920x1080) else {
            print("ERROR: no export session"); sem.signal(); return
        }
        ex.outputURL = out
        ex.outputFileType = .mp4
        ex.videoComposition = vc
        try await ex.export(to: out, as: .mp4)
        print("wrote \(out.path)  \(String(format: "%.2f", total))s  \(Int(W))x\(Int(H))")
    } catch {
        print("ERROR: \(error)")
    }
    sem.signal()
}
sem.wait()
