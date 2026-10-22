// Cover / thumbnail for the GameClaw advertisement.
//
//   cover <out.png> <W> <H> <screenshot.png>
//
// Brand lockup plus a real screenshot of the app, framed as a device. Same mark geometry and the
// same palette as the video, so the thumbnail and the film read as one piece.

import Foundation
import AppKit
import CoreGraphics
import CoreText

let INK = CGColor(red: 0.035, green: 0.035, blue: 0.043, alpha: 1)
let LIME = CGColor(red: 0.80, green: 1.00, blue: 0.18, alpha: 1)
let WHITE = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
let MUTED = CGColor(red: 0.63, green: 0.63, blue: 0.67, alpha: 1)

func clawPath(size: CGFloat) -> CGPath {
    let slashes: [(r: CGFloat, from: CGFloat, to: CGFloat, w: CGFloat)] = [
        (1.032, -1.181, -0.463, 0.070),
        (1.202, -1.245, -0.390, 0.086),
        (1.372, -1.181, -0.463, 0.070),
    ]
    let ox = -0.35 * size, oy = 1.35 * size
    let path = CGMutablePath(); let steps = 28
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

let out = URL(fileURLWithPath: CommandLine.arguments[1])
let W = CGFloat(Int(CommandLine.arguments[2])!)
let H = CGFloat(Int(CommandLine.arguments[3])!)
let shot = CommandLine.arguments[4]
let landscape = W > H
let U = min(W, H)

let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8,
                    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.setFillColor(INK)
ctx.fill(CGRect(x: 0, y: 0, width: W, height: H))

// ---- device inset, from a real screenshot ----
if let img = NSImage(contentsOfFile: shot), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) {
    let srcAspect = CGFloat(cg.width) / CGFloat(cg.height)
    let devH = landscape ? H * 0.84 : H * 0.46
    let devW = devH * srcAspect
    let x = landscape ? W * 0.62 : (W - devW) / 2
    let y = landscape ? (H - devH) / 2 : H * 0.07
    let rect = CGRect(x: x, y: y, width: devW, height: devH)
    ctx.saveGState()
    let clip = CGPath(roundedRect: rect, cornerWidth: U * 0.022, cornerHeight: U * 0.022, transform: nil)
    ctx.addPath(clip); ctx.clip()
    ctx.draw(cg, in: rect)
    ctx.restoreGState()
    // hairline edge so the screenshot reads as a device rather than a pasted rectangle
    ctx.addPath(clip)
    ctx.setStrokeColor(CGColor(red: 1, green: 1, blue: 1, alpha: 0.10))
    ctx.setLineWidth(max(1, U * 0.0022))
    ctx.strokePath()
}

// ---- brand lockup ----
let markSize = U * (landscape ? 0.17 : 0.17)
let markCentre = landscape ? CGPoint(x: W * 0.30, y: H * 0.70) : CGPoint(x: W / 2, y: H * 0.78)
let p = clawPath(size: markSize)
let b = p.boundingBox
let moved = CGMutablePath()
moved.addPath(p, transform: CGAffineTransform(translationX: markCentre.x - b.midX,
                                              y: markCentre.y - b.midY))
ctx.addPath(moved); ctx.setFillColor(LIME); ctx.fillPath()

func draw(_ s: String, size: CGFloat, colour: CGColor, bold: Bool, centreX: CGFloat, y: CGFloat, maxW: CGFloat) {
    let font = CTFontCreateWithName((bold ? "HelveticaNeue-Bold" : "HelveticaNeue") as CFString, size, nil)
    let para = NSMutableParagraphStyle(); para.alignment = .center
    let attr = NSAttributedString(string: s, attributes: [
        .font: font, .foregroundColor: NSColor(cgColor: colour) ?? .white, .paragraphStyle: para,
    ])
    let gctx = NSGraphicsContext(cgContext: ctx, flipped: false)
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = gctx
    let r = attr.boundingRect(with: CGSize(width: maxW, height: .greatestFiniteMagnitude),
                              options: [.usesLineFragmentOrigin])
    attr.draw(with: CGRect(x: centreX - maxW / 2, y: y, width: maxW, height: r.height + 4),
              options: [.usesLineFragmentOrigin])
    NSGraphicsContext.restoreGraphicsState()
}

let cx = landscape ? W * 0.30 : W / 2
let maxW = landscape ? W * 0.52 : W * 0.86
draw("GAMECLAW", size: U * 0.085, colour: WHITE, bold: true,
     centreX: cx, y: landscape ? H * 0.47 : H * 0.665, maxW: maxW)
draw("Follow the game. Own your matchday.", size: U * 0.040, colour: MUTED, bold: false,
     centreX: cx, y: landscape ? H * 0.38 : H * 0.615, maxW: maxW)
draw("gameclaw.win", size: U * 0.038, colour: LIME, bold: true,
     centreX: cx, y: landscape ? H * 0.28 : H * 0.555, maxW: maxW)

let img = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: img)
try! rep.representation(using: .png, properties: [:])!.write(to: out)
print("wrote \(out.path)  \(Int(W))x\(Int(H))")
