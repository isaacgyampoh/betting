import Foundation
import AVFoundation
import CoreGraphics
import QuartzCore

let url = URL(fileURLWithPath: CommandLine.arguments[1])
let asset = AVURLAsset(url: url)
let sem = DispatchSemaphore(value: 0)
Task {
    do {
        let dur = try await asset.load(.duration)
        let tracks = try await asset.loadTracks(withMediaType: .video)
        if let t = tracks.first {
            let size = try await t.load(.naturalSize)
            print("duration: \(CMTimeGetSeconds(dur))s  size: \(Int(size.width))x\(Int(size.height))  tracks: \(tracks.count)")
        }
        // prove CoreAnimation layers are available for overlays
        let l = CATextLayer(); l.string = "GameClaw"; l.fontSize = 48
        print("CATextLayer ok: \(l.fontSize)")
    } catch { print("ERROR: \(error)") }
    sem.signal()
}
sem.wait()
