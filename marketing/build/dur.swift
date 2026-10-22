import Foundation
import AVFoundation
let sem = DispatchSemaphore(value: 0)
Task {
    for p in CommandLine.arguments.dropFirst() {
        let a = AVURLAsset(url: URL(fileURLWithPath: p))
        if let d = try? await a.load(.duration) {
            print(String(format: "%.3f\t%@", CMTimeGetSeconds(d), (p as NSString).lastPathComponent))
        }
    }
    sem.signal()
}
sem.wait()
