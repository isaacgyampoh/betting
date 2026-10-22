import Foundation
import AVFoundation
import CoreImage
import AppKit

// grab <video> <outdir> <t1,t2,t3,...>
let url = URL(fileURLWithPath: CommandLine.arguments[1])
let dir = CommandLine.arguments[2]
let times = CommandLine.arguments[3].split(separator: ",").map { Double($0)! }
let asset = AVURLAsset(url: url)
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
let sem = DispatchSemaphore(value: 0)
Task {
    for t in times {
        do {
            let (img, _) = try await gen.image(at: CMTime(seconds: t, preferredTimescale: 600))
            let rep = NSBitmapImageRep(cgImage: img)
            let png = rep.representation(using: .png, properties: [:])!
            let p = "\(dir)/frame-\(String(format: "%05.1f", t)).png"
            try png.write(to: URL(fileURLWithPath: p))
            print("  \(p)  \(img.width)x\(img.height)")
        } catch { print("  t=\(t) ERROR \(error)") }
    }
    sem.signal()
}
sem.wait()
