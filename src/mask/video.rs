use bevy::asset::{Asset, RenderAssetUsages};
use bevy::image::ImageSampler;
use bevy::prelude::*;
use bevy::render::render_resource::{
    AsBindGroup, Extent3d, ShaderType, TextureDimension, TextureFormat, TextureUsages,
};
use bevy::shader::ShaderRef;
use bevy_ui_render::prelude::{MaterialNode, UiMaterial};

use crate::mask::{
    mask_command::{MaskSize, TitlebarState},
    window_state::{MaskFullscreenState, MaskMaximizeState},
};
use crate::scrcpy::media::{
    VideoFrameTrace, VideoMsg, YuvColorInfo, YuvMatrix, YuvPlaneLayout, YuvRange,
};
use crate::{
    tokio_tasks::TokioTasksRuntime,
    utils::{ChannelReceiverV, ChannelReceiverVideoSnapshot},
};


#[derive(Resource, Clone, Copy, Debug)]
pub struct VideoViewport {
    /// 最新视频帧原始尺寸，用于 contain 缩放。
    pub source_size: Vec2,
    /// 视频画面相对投屏内容区域左上角的偏移（黑边大小）。
    pub offset: Vec2,
    /// 实际显示视频区域尺寸，也是键位映射使用的 MaskSize。
    pub size: Vec2,
}

impl Default for VideoViewport {
    fn default() -> Self {
        Self {
            source_size: Vec2::ZERO,
            offset: Vec2::ZERO,
            size: Vec2::ZERO,
        }
    }
}

impl VideoViewport {
    fn contain(source: Vec2, available: Vec2) -> (Vec2, Vec2) {
        if source.x <= 0.0 || source.y <= 0.0 || available.x <= 0.0 || available.y <= 0.0 {
            return (Vec2::ZERO, Vec2::new(available.x.max(0.0), available.y.max(0.0)));
        }

        let scale = (available.x / source.x).min(available.y / source.y);
        let size = source * scale;
        let offset = ((available - size) * 0.5).max(Vec2::ZERO);
        (offset, size)
    }
}

/// 统一计算视频显示矩形。普通窗口保持原来的等比例窗口行为；
/// F11 全屏和普通窗口最大化时使用 contain 缩放，多余区域显示黑边而不是拉伸。
pub fn sync_video_viewport(
    window: Single<&Window>,
    titlebar_state: Res<TitlebarState>,
    fullscreen_state: Res<MaskFullscreenState>,
    maximize_state: Res<MaskMaximizeState>,
    mut viewport: ResMut<VideoViewport>,
    mut mask_size: ResMut<MaskSize>,
    mut video_query: Query<&mut Node, With<VideoPlayer>>,
) {
    let available = Vec2::new(
        window.size().x.max(0.0),
        if fullscreen_state.active {
            window.size().y.max(0.0)
        } else {
            (window.size().y - titlebar_state.offset()).max(0.0)
        },
    );

    let letterbox = fullscreen_state.active || maximize_state.active;
    let (offset, size) = if letterbox {
        VideoViewport::contain(viewport.source_size, available)
    } else {
        (Vec2::ZERO, available)
    };

    viewport.offset = offset;
    viewport.size = size;
    mask_size.0 = size;

    for mut node in video_query.iter_mut() {
        node.left = Val::Px(offset.x);
        node.top = Val::Px(offset.y);
        node.width = Val::Px(size.x);
        node.height = Val::Px(size.y);
    }
}

#[derive(AsBindGroup, Asset, TypePath, Debug, Clone)]
pub struct YuvVideoMaterial {
    #[texture(0)]
    #[sampler(1)]
    pub y_texture: Handle<Image>,
    #[texture(2)]
    #[sampler(3)]
    pub u_texture: Handle<Image>,
    #[texture(4)]
    #[sampler(5)]
    pub v_texture: Handle<Image>,
    #[uniform(6)]
    pub params: YuvParams,
}

impl UiMaterial for YuvVideoMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/yuv_video.wgsl".into()
    }
}

#[derive(Clone, Copy, ShaderType, Debug, Default, PartialEq, Eq)]
pub struct YuvParams {
    pub mode: u32,
    pub matrix: u32,
    pub range: u32,
    pub _pad: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum YuvTextureMode {
    Yuv420p,
    Nv12,
}

#[derive(Resource, Default)]
pub struct VideoAttributes {
    width: u32,
    height: u32,
    mode: Option<YuvTextureMode>,
    planes: Option<YuvPlaneLayout>,
    y_handle: Option<Handle<Image>>,
    u_handle: Option<Handle<Image>>,
    v_handle: Option<Handle<Image>>,
    material_handle: Option<Handle<YuvVideoMaterial>>,
    color: Option<YuvColorInfo>,
}

impl VideoAttributes {
    fn update_yuv420p(
        &mut self,
        frame: Yuv420pFrame,
        images: &mut Assets<Image>,
        materials: &mut Assets<YuvVideoMaterial>,
        video_node: &mut MaterialNode<YuvVideoMaterial>,
        v_rx: &ChannelReceiverV,
    ) -> (bool, bool) {
        self.color = Some(frame.color);
        let rebuilt = self.ensure_assets(
            frame.width,
            frame.height,
            frame.planes,
            YuvTextureMode::Yuv420p,
            images,
            materials,
            video_node,
        );
        let params_updated = self.update_material_params(frame.color, materials);
        replace_image_data(images, self.y_handle.as_ref().unwrap(), frame.y, v_rx);
        replace_image_data(images, self.u_handle.as_ref().unwrap(), frame.u, v_rx);
        replace_image_data(images, self.v_handle.as_ref().unwrap(), frame.v, v_rx);
        (rebuilt, params_updated)
    }

    fn update_nv12(
        &mut self,
        frame: Nv12Frame,
        images: &mut Assets<Image>,
        materials: &mut Assets<YuvVideoMaterial>,
        video_node: &mut MaterialNode<YuvVideoMaterial>,
        v_rx: &ChannelReceiverV,
    ) -> (bool, bool) {
        self.color = Some(frame.color);
        let rebuilt = self.ensure_assets(
            frame.width,
            frame.height,
            frame.planes,
            YuvTextureMode::Nv12,
            images,
            materials,
            video_node,
        );
        let params_updated = self.update_material_params(frame.color, materials);
        replace_image_data(images, self.y_handle.as_ref().unwrap(), frame.y, v_rx);
        replace_image_data(images, self.u_handle.as_ref().unwrap(), frame.uv, v_rx);
        (rebuilt, params_updated)
    }

    fn ensure_assets(
        &mut self,
        width: u32,
        height: u32,
        planes: YuvPlaneLayout,
        mode: YuvTextureMode,
        images: &mut Assets<Image>,
        materials: &mut Assets<YuvVideoMaterial>,
        video_node: &mut MaterialNode<YuvVideoMaterial>,
    ) -> bool {
        if self.material_handle.is_some()
            && self.width == width
            && self.height == height
            && self.planes == Some(planes)
            && self.mode == Some(mode)
        {
            return false;
        }

        self.width = width;
        self.height = height;
        self.mode = Some(mode);
        self.planes = Some(planes);

        let y_handle = images.add(create_plane_image(
            planes.y_width,
            planes.y_height,
            TextureFormat::R8Unorm,
            &[0],
        ));

        let (u_handle, v_handle) = match mode {
            YuvTextureMode::Yuv420p => (
                images.add(create_plane_image(
                    planes.uv_width,
                    planes.uv_height,
                    TextureFormat::R8Unorm,
                    &[128],
                )),
                images.add(create_plane_image(
                    planes.uv_width,
                    planes.uv_height,
                    TextureFormat::R8Unorm,
                    &[128],
                )),
            ),
            YuvTextureMode::Nv12 => (
                images.add(create_plane_image(
                    planes.uv_width,
                    planes.uv_height,
                    TextureFormat::Rg8Unorm,
                    &[128, 128],
                )),
                images.add(create_plane_image(1, 1, TextureFormat::R8Unorm, &[128])),
            ),
        };

        let params = YuvParams {
            mode: mode_to_shader_value(mode),
            ..default()
        };
        let material_handle = materials.add(YuvVideoMaterial {
            y_texture: y_handle.clone(),
            u_texture: u_handle.clone(),
            v_texture: v_handle.clone(),
            params,
        });

        video_node.0 = material_handle.clone();
        self.y_handle = Some(y_handle);
        self.u_handle = Some(u_handle);
        self.v_handle = Some(v_handle);
        self.material_handle = Some(material_handle);
        true
    }

    fn update_material_params(
        &mut self,
        color: YuvColorInfo,
        materials: &mut Assets<YuvVideoMaterial>,
    ) -> bool {
        let Some(material_handle) = self.material_handle.as_ref() else {
            return false;
        };
        let Some(mut material) = materials.get_mut(material_handle) else {
            return false;
        };

        let params = YuvParams {
            mode: mode_to_shader_value(self.mode.unwrap()),
            matrix: matrix_to_shader_value(color.matrix),
            range: range_to_shader_value(color.range),
            _pad: 0,
        };
        if material.params == params {
            return false;
        }

        material.params = params;
        true
    }

    fn clear(&mut self, images: &mut Assets<Image>, v_rx: &ChannelReceiverV) {
        for handle in [
            self.y_handle.as_ref(),
            self.u_handle.as_ref(),
            self.v_handle.as_ref(),
        ]
        .into_iter()
        .flatten()
        {
            clear_image_data(images, handle, v_rx);
        }
        *self = Self::default();
    }
}

struct Yuv420pFrame {
    y: Vec<u8>,
    u: Vec<u8>,
    v: Vec<u8>,
    width: u32,
    height: u32,
    planes: YuvPlaneLayout,
    color: YuvColorInfo,
}

struct Nv12Frame {
    y: Vec<u8>,
    uv: Vec<u8>,
    width: u32,
    height: u32,
    planes: YuvPlaneLayout,
    color: YuvColorInfo,
}

#[derive(Component)]
pub struct VideoPlayer;

pub fn create_initial_yuv_material(
    images: &mut Assets<Image>,
    materials: &mut Assets<YuvVideoMaterial>,
) -> Handle<YuvVideoMaterial> {
    let y_texture = images.add(create_plane_image(1, 1, TextureFormat::R8Unorm, &[0]));
    let u_texture = images.add(create_plane_image(1, 1, TextureFormat::R8Unorm, &[128]));
    let v_texture = images.add(create_plane_image(1, 1, TextureFormat::R8Unorm, &[128]));

    materials.add(YuvVideoMaterial {
        y_texture,
        u_texture,
        v_texture,
        params: YuvParams::default(),
    })
}

pub fn handle_video_msg(
    v_rx: Res<ChannelReceiverV>,
    mut viewport: ResMut<VideoViewport>,
    mut images: ResMut<Assets<Image>>,
    mut materials: ResMut<Assets<YuvVideoMaterial>>,
    mut video_attr: ResMut<VideoAttributes>,
    mut video_node: Single<(
        &mut MaterialNode<YuvVideoMaterial>,
        &mut Node,
        &mut VideoPlayer,
    )>,
) {
    if let Some(mut msg) = v_rx.0.take() {
        if let Some(trace) = msg.trace_mut() {
            trace.ui_taken_at = Some(std::time::Instant::now());
        }
        match msg {
            VideoMsg::Yuv420p {
                y,
                u,
                v,
                width,
                height,
                planes,
                color,
                mut trace,
            } => {
                viewport.source_size = Vec2::new(width as f32, height as f32);
                let _t = crate::perf::timed("ui.update_textures");
                video_attr.update_yuv420p(
                    Yuv420pFrame {
                        y,
                        u,
                        v,
                        width,
                        height,
                        planes,
                        color,
                    },
                    &mut images,
                    &mut materials,
                    &mut video_node.0,
                    &v_rx,
                );
                video_node.1.display = Display::Flex;
                finish_lowcast_trace(&mut trace, &v_rx);
            }
            VideoMsg::Nv12 {
                y,
                uv,
                width,
                height,
                planes,
                color,
                mut trace,
            } => {
                viewport.source_size = Vec2::new(width as f32, height as f32);
                let _t = crate::perf::timed("ui.update_textures");
                video_attr.update_nv12(
                    Nv12Frame {
                        y,
                        uv,
                        width,
                        height,
                        planes,
                        color,
                    },
                    &mut images,
                    &mut materials,
                    &mut video_node.0,
                    &v_rx,
                );
                video_node.1.display = Display::Flex;
                finish_lowcast_trace(&mut trace, &v_rx);
            }
            VideoMsg::Close => {
                viewport.source_size = Vec2::ZERO;
                viewport.offset = Vec2::ZERO;
                viewport.size = Vec2::ZERO;
                video_attr.clear(&mut images, &v_rx);
                video_node.1.display = Display::None;
            }
        }
    }
}



#[derive(Clone)]
struct VideoSnapshotFrame {
    width: u32,
    height: u32,
    planes: YuvPlaneLayout,
    mode: YuvTextureMode,
    color: YuvColorInfo,
    y: Vec<u8>,
    u_or_uv: Vec<u8>,
    v: Option<Vec<u8>>,
}

/// Respond to mapping-background screenshot requests using the exact YUV frame currently
/// stored in the LowCast renderer. The expensive YUV->RGB + PNG encoding work runs on the
/// background Tokio runtime, so refreshing a mapping background does not turn every video
/// frame into a screenshot and does not add steady-state latency to the hot path.
pub fn handle_video_snapshot_requests(
    requests: Res<ChannelReceiverVideoSnapshot>,
    video_attr: Res<VideoAttributes>,
    images: Res<Assets<Image>>,
    runtime: Res<TokioTasksRuntime>,
) {
    for response_tx in requests.0.try_iter() {
        let snapshot = clone_current_video_snapshot(&video_attr, &images);
        match snapshot {
            Ok(snapshot) => {
                runtime.spawn_background_task(move |_ctx| async move {
                    let result = snapshot.encode_png();
                    let _ = response_tx.send(result);
                });
            }
            Err(error) => {
                let _ = response_tx.send(Err(error));
            }
        }
    }
}

fn clone_current_video_snapshot(
    video_attr: &VideoAttributes,
    images: &Assets<Image>,
) -> Result<VideoSnapshotFrame, String> {
    let mode = video_attr
        .mode
        .ok_or_else(|| "no LowCast video frame is currently available".to_string())?;
    let planes = video_attr
        .planes
        .ok_or_else(|| "current video plane layout is unavailable".to_string())?;
    let color = video_attr
        .color
        .ok_or_else(|| "current video color metadata is unavailable".to_string())?;

    if video_attr.width == 0 || video_attr.height == 0 {
        return Err("current LowCast video frame has an invalid size".to_string());
    }

    let clone_image_data = |handle: &Option<Handle<Image>>, name: &str| -> Result<Vec<u8>, String> {
        let handle = handle
            .as_ref()
            .ok_or_else(|| format!("current video {name} texture is unavailable"))?;
        let image = images
            .get(handle)
            .ok_or_else(|| format!("current video {name} texture asset is unavailable"))?;
        image
            .data
            .as_ref()
            .cloned()
            .ok_or_else(|| format!("current video {name} plane has no CPU-side data"))
    };

    let y = clone_image_data(&video_attr.y_handle, "Y")?;
    let u_or_uv = clone_image_data(&video_attr.u_handle, "U/UV")?;
    let v = if mode == YuvTextureMode::Yuv420p {
        Some(clone_image_data(&video_attr.v_handle, "V")?)
    } else {
        None
    };

    let expected_y = (planes.y_width as usize)
        .checked_mul(planes.y_height as usize)
        .ok_or_else(|| "Y plane size overflow".to_string())?;
    if y.len() < expected_y {
        return Err(format!(
            "current Y plane is truncated: {} < {}",
            y.len(), expected_y
        ));
    }

    let uv_pixels = (planes.uv_width as usize)
        .checked_mul(planes.uv_height as usize)
        .ok_or_else(|| "UV plane size overflow".to_string())?;
    let expected_uv = if mode == YuvTextureMode::Nv12 {
        uv_pixels
            .checked_mul(2)
            .ok_or_else(|| "NV12 UV plane size overflow".to_string())?
    } else {
        uv_pixels
    };
    if u_or_uv.len() < expected_uv {
        return Err(format!(
            "current U/UV plane is truncated: {} < {}",
            u_or_uv.len(), expected_uv
        ));
    }
    if let Some(v) = &v
        && v.len() < uv_pixels
    {
        return Err(format!(
            "current V plane is truncated: {} < {}",
            v.len(), uv_pixels
        ));
    }

    Ok(VideoSnapshotFrame {
        width: video_attr.width,
        height: video_attr.height,
        planes,
        mode,
        color,
        y,
        u_or_uv,
        v,
    })
}

impl VideoSnapshotFrame {
    fn encode_png(self) -> Result<Vec<u8>, String> {
        let pixel_count = (self.width as usize)
            .checked_mul(self.height as usize)
            .ok_or_else(|| "video snapshot pixel count overflow".to_string())?;
        let mut rgb = Vec::with_capacity(
            pixel_count
                .checked_mul(3)
                .ok_or_else(|| "video snapshot RGB size overflow".to_string())?,
        );

        let y_stride = self.planes.y_width as usize;
        let uv_stride = self.planes.uv_width as usize;
        let v_plane = self.v.as_deref();

        for py in 0..self.height as usize {
            let uv_y = (py / 2).min(self.planes.uv_height.saturating_sub(1) as usize);
            for px in 0..self.width as usize {
                let y_value = self.y[py * y_stride + px];
                let uv_x = (px / 2).min(self.planes.uv_width.saturating_sub(1) as usize);
                let uv_index = uv_y * uv_stride + uv_x;

                let (u_value, v_value) = match self.mode {
                    YuvTextureMode::Yuv420p => {
                        let v_plane = v_plane.ok_or_else(|| {
                            "YUV420P snapshot is missing the V plane".to_string()
                        })?;
                        (self.u_or_uv[uv_index], v_plane[uv_index])
                    }
                    YuvTextureMode::Nv12 => {
                        let base = uv_index * 2;
                        (self.u_or_uv[base], self.u_or_uv[base + 1])
                    }
                };

                let (r, g, b) = yuv_pixel_to_rgb(y_value, u_value, v_value, self.color);
                rgb.extend_from_slice(&[r, g, b]);
            }
        }

        let mut output = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut output, self.width, self.height);
            encoder.set_color(png::ColorType::Rgb);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder
                .write_header()
                .map_err(|e| format!("failed to create PNG header: {e}"))?;
            writer
                .write_image_data(&rgb)
                .map_err(|e| format!("failed to encode current LowCast frame as PNG: {e}"))?;
        }
        Ok(output)
    }
}

fn yuv_pixel_to_rgb(y: u8, u: u8, v: u8, color: YuvColorInfo) -> (u8, u8, u8) {
    let y_raw = y as f32 / 255.0;
    let u_raw = u as f32 / 255.0;
    let v_raw = v as f32 / 255.0;

    let (y, u, v) = match color.range {
        YuvRange::Limited => (
            (y_raw - 16.0 / 255.0) * (255.0 / 219.0),
            (u_raw - 128.0 / 255.0) * (255.0 / 224.0),
            (v_raw - 128.0 / 255.0) * (255.0 / 224.0),
        ),
        YuvRange::Full => (y_raw, u_raw - 0.5, v_raw - 0.5),
    };

    let (r, g, b) = match color.matrix {
        YuvMatrix::Bt601 => (
            y + 1.4020 * v,
            y - 0.3441 * u - 0.7141 * v,
            y + 1.7720 * u,
        ),
        YuvMatrix::Bt709 => (
            y + 1.5748 * v,
            y - 0.1873 * u - 0.4681 * v,
            y + 1.8556 * u,
        ),
        YuvMatrix::Bt2020 => (
            y + 1.4746 * v,
            y - 0.1646 * u - 0.5714 * v,
            y + 1.8814 * u,
        ),
    };

    let to_u8 = |value: f32| -> u8 { (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8 };
    (to_u8(r), to_u8(g), to_u8(b))
}

fn finish_lowcast_trace(trace: &mut Option<VideoFrameTrace>, v_rx: &ChannelReceiverV) {
    let Some(trace) = trace.as_mut() else {
        return;
    };
    let now = std::time::Instant::now();
    trace.ui_ready_at = Some(now);

    // One line per ~60 frames keeps telemetry useful without perturbing the hot path too much.
    if trace.sequence == 0 || trace.sequence % 60 != 0 {
        return;
    }

    let decode_output = trace.decode_output_at.unwrap_or(trace.decode_submitted_at);
    let copy_finished = trace.copy_finished_at.unwrap_or(decode_output);
    let queued = trace.queued_at.unwrap_or(copy_finished);
    let ui_taken = trace.ui_taken_at.unwrap_or(queued);

    log::info!(
        "[LowCast][Latency] frame={} pts={:?} socket->submit={:.2}ms decode={:.2}ms copy={:.2}ms slot={:.2}ms ui_wait={:.2}ms ui_update={:.2}ms client_total={:.2}ms dropped={} delivered={}",
        trace.sequence,
        trace.pts,
        VideoFrameTrace::elapsed_ms(trace.socket_received_at, trace.decode_submitted_at),
        VideoFrameTrace::elapsed_ms(trace.decode_submitted_at, decode_output),
        VideoFrameTrace::elapsed_ms(decode_output, copy_finished),
        VideoFrameTrace::elapsed_ms(copy_finished, queued),
        VideoFrameTrace::elapsed_ms(queued, ui_taken),
        VideoFrameTrace::elapsed_ms(ui_taken, now),
        VideoFrameTrace::elapsed_ms(trace.socket_received_at, now),
        v_rx.0.dropped_frames(),
        v_rx.0.delivered_frames(),
    );
}

fn create_plane_image(width: u32, height: u32, format: TextureFormat, fill: &[u8]) -> Image {
    let mut image = Image::new_fill(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        fill,
        format,
        RenderAssetUsages::RENDER_WORLD | RenderAssetUsages::MAIN_WORLD,
    );
    image.texture_descriptor.usage = TextureUsages::COPY_DST | TextureUsages::TEXTURE_BINDING;
    image.sampler = ImageSampler::linear();
    image
}

fn replace_image_data(
    images: &mut Assets<Image>,
    handle: &Handle<Image>,
    data: Vec<u8>,
    v_rx: &ChannelReceiverV,
) {
    if let Some(mut image) = images.get_mut(handle) {
        if let Some(old_data) = image.data.replace(data) {
            v_rx.0.recycle_buffer(old_data);
        }
    }
}

fn clear_image_data(images: &mut Assets<Image>, handle: &Handle<Image>, v_rx: &ChannelReceiverV) {
    if let Some(mut image) = images.get_mut(handle)
        && let Some(old_data) = image.data.take()
    {
        let length = old_data.len();
        v_rx.0.recycle_buffer(old_data);
        let mut clear_data = v_rx.0.take_buffer(length);
        clear_data.fill(0);
        image.data = Some(clear_data);
    }
}

fn mode_to_shader_value(mode: YuvTextureMode) -> u32 {
    match mode {
        YuvTextureMode::Yuv420p => 0,
        YuvTextureMode::Nv12 => 1,
    }
}

fn matrix_to_shader_value(matrix: YuvMatrix) -> u32 {
    match matrix {
        YuvMatrix::Bt601 => 0,
        YuvMatrix::Bt709 => 1,
        YuvMatrix::Bt2020 => 2,
    }
}

fn range_to_shader_value(range: YuvRange) -> u32 {
    match range {
        YuvRange::Limited => 0,
        YuvRange::Full => 1,
    }
}
