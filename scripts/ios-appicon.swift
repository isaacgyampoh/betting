// Renders the GameClaw mark into every iOS app-icon size.
//
//   swiftc -O -o /tmp/ios-appicon scripts/ios-appicon.swift
//   /tmp/ios-appicon gameclaw_app/ios/Runner/Assets.xcassets/AppIcon.appiconset/
//
// Swift rather than the Python that draws the Play assets: scripts/play-graphics.py needs PIL,
// which is not installed here, and CoreGraphics is. The geometry is identical either way.
//
// Same geometry as marketing/build/cover.swift, so the app icon, the advertisement and the
// website are one mark rather than three drawings of it. Opaque and square on purpose: iOS
// applies its own mask, and an icon that ships with alpha or pre-rounded corners is rejected.
import Foundation
import AppKit
import CoreGraphics

let INK = CGColor(red: 0.035, green: 0.035, blue: 0.043, alpha: 1)
let LIME = CGColor(red: 0.80, green: 1.00, blue: 0.18, alpha: 1)

func clawPath(size: CGFloat) -> CGPath {
    let slashes: [(r: CGFloat, from: CGFloat, to: CGFloat, w: CGFloat)] = [
        (1.032, -1.181, -0.463, 0.070),
        (1.202, -1.245, -0.390, 0.086),
        (1.372, -1.181, -0.463, 0.070),
    ]
    let ox = -0.35 * size, oy = 1.35 * size
    let path = CGMutablePath(); let steps = 64
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

func render(px: Int, to url: URL) {
    // Drawn at 4x and downsampled: the mark is three tapered curves, and at 20pt a direct render
    // renders them as stair-steps.
    let ss = 4, side = px * ss
    let ctx = CGContext(data: nil, width: side, height: side, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    ctx.setFillColor(INK)
    ctx.fill(CGRect(x: 0, y: 0, width: side, height: side))

    // The mark occupies 62% of the tile, which is where it sits on the Android icon too.
    let markSize = CGFloat(side) * 0.62
    let p = clawPath(size: markSize)
    let b = p.boundingBox
    // Flipped in y. CoreGraphics' origin is bottom-left, and the geometry in cover.swift was
    // authored for a context where that read the right way up; rendered straight into a bitmap it
    // comes out mirrored, with the claw raking up-right instead of down-left. Checked against
    // play-assets/icon-512.png, which is the mark the Play listing and the Android app already
    // use - the icon has to be the same drawing, not a reflection of it.
    let moved = CGMutablePath()
    var flip = CGAffineTransform(translationX: CGFloat(side) / 2 - b.midX,
                                 y: CGFloat(side) / 2 + b.midY)
    flip = flip.scaledBy(x: 1, y: -1)
    moved.addPath(p, transform: flip)
    ctx.addPath(moved); ctx.setFillColor(LIME); ctx.fillPath()

    let full = ctx.makeImage()!
    let out = CGContext(data: nil, width: px, height: px, bitsPerComponent: 8, bytesPerRow: 0,
                        space: CGColorSpaceCreateDeviceRGB(),
                        bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
    out.interpolationQuality = .high
    out.draw(full, in: CGRect(x: 0, y: 0, width: px, height: px))
    let rep = NSBitmapImageRep(cgImage: out.makeImage()!)
    try! rep.representation(using: .png, properties: [:])!.write(to: url)
}

let dir = URL(fileURLWithPath: CommandLine.arguments[1])
// name -> pixel size, from the appiconset's own Contents.json.
let sizes: [(String, Int)] = [
    ("Icon-App-20x20@1x.png", 20), ("Icon-App-20x20@2x.png", 40), ("Icon-App-20x20@3x.png", 60),
    ("Icon-App-29x29@1x.png", 29), ("Icon-App-29x29@2x.png", 58), ("Icon-App-29x29@3x.png", 87),
    ("Icon-App-40x40@1x.png", 40), ("Icon-App-40x40@2x.png", 80), ("Icon-App-40x40@3x.png", 120),
    ("Icon-App-60x60@2x.png", 120), ("Icon-App-60x60@3x.png", 180),
    ("Icon-App-76x76@1x.png", 76), ("Icon-App-76x76@2x.png", 152),
    ("Icon-App-83.5x83.5@2x.png", 167),
    ("Icon-App-1024x1024@1x.png", 1024),
]
for (name, px) in sizes {
    render(px: px, to: dir.appendingPathComponent(name))
    print("  \(name)  \(px)x\(px)")
}
