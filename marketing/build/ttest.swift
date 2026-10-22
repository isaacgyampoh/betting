import Foundation
import QuartzCore
import CoreText
import AppKit

let W = 1080.0, H = 400.0
let root = CALayer()
root.frame = CGRect(x: 0, y: 0, width: W, height: H)
root.backgroundColor = CGColor(red: 0.035, green: 0.035, blue: 0.043, alpha: 1)

func mk(_ s: String, y: CGFloat, size: CGFloat, useCT: Bool) -> CATextLayer {
    let l = CATextLayer()
    if useCT { l.font = CTFontCreateWithName("HelveticaNeue-Bold" as CFString, size, nil) }
    else { l.font = "HelveticaNeue-Bold" as CFString }
    l.fontSize = size
    l.string = s
    l.foregroundColor = CGColor(red: 1, green: 1, blue: 1, alpha: 1)
    l.alignmentMode = .center
    l.frame = CGRect(x: 0, y: y, width: W, height: size * 1.6)
    l.contentsScale = 2
    return l
}
root.addSublayer(mk("CTFont path", y: 240, size: 64, useCT: true))
root.addSublayer(mk("CFString path", y: 120, size: 64, useCT: false))

let ctx = CGContext(data: nil, width: Int(W), height: Int(H), bitsPerComponent: 8,
                    bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
root.render(in: ctx)
let img = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: img)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: "qa/ttest.png"))
print("wrote qa/ttest.png")
