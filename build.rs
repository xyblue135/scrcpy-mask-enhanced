fn main() {
    #[cfg(target_os = "linux")]
    {
        pkg_config::probe_library("x11").expect("Failed to find libX11 via pkg-config");
        pkg_config::probe_library("vdpau").expect("Failed to find libvdpau via pkg-config");
        pkg_config::probe_library("libva").expect("Failed to find libva");
        pkg_config::probe_library("libva-x11").expect("Failed to find libva-x11");
        pkg_config::probe_library("libva-drm").expect("Failed to find libva-drm");
        pkg_config::probe_library("libdrm").expect("Failed to find libdrm via pkg-config");
    }

    #[cfg(target_os = "windows")]
    {
        // D3D11VA 硬件解码需要链接的系统库（静态链接 FFmpeg 时传递引用）
        println!("cargo:rustc-link-lib=d3d11");
        println!("cargo:rustc-link-lib=dxgi");
        // 静态链接的 FFmpeg(MSVC 编译)引用静态 CRT 默认库 LIBCMT，
        // 与 Rust 默认的动态 CRT(UCRT) 冲突，产生 LNK4098 警告。
        // 符号实际都能在 UCRT 中解析，忽略 LIBCMT 即可消除该无害警告。
        println!("cargo:rustc-link-arg=/NODEFAULTLIB:LIBCMT");
    }
}
