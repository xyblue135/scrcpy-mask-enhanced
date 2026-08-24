use std::{collections::VecDeque, fmt, time::Instant};

use ffmpeg_next::{
    ChannelLayout, Packet, Rational, codec, decoder, ffi, frame, packet,
    util::format::{Pixel, Sample},
};
use rust_i18n::t;
use serde::{Deserialize, Serialize};
use tokio::{io::AsyncReadExt, net::TcpStream};

const SC_PACKET_FLAG_SESSION: u64 = 1u64 << 63;
const SC_PACKET_FLAG_CONFIG: u64 = 1u64 << 62;
const SC_PACKET_FLAG_KEY_FRAME: u64 = 1u64 << 61;
const SC_PACKET_PTS_MASK: u64 = SC_PACKET_FLAG_KEY_FRAME - 1;
const MAX_MEDIA_PACKET_SIZE: usize = 64 * 1024 * 1024;
/// 数据读取细分：首个数据块大小，作为「等待数据到达(延迟)」与「持续传输(带宽)」的分界。
const FIRST_CHUNK_BYTES: usize = 64 * 1024;
const SC_PACKET_TIME_BASE: Rational = Rational(1, 1_000_000);
const SC_AUDIO_SAMPLE_RATE: i32 = 48_000;


#[derive(Clone, Copy, Debug)]
pub struct VideoFrameTrace {
    pub sequence: u64,
    pub pts: Option<i64>,
    pub socket_received_at: Instant,
    pub decode_submitted_at: Instant,
    pub decode_output_at: Option<Instant>,
    pub copy_finished_at: Option<Instant>,
    pub queued_at: Option<Instant>,
    pub ui_taken_at: Option<Instant>,
    pub ui_ready_at: Option<Instant>,
}

impl VideoFrameTrace {
    pub fn new(
        sequence: u64,
        pts: Option<i64>,
        socket_received_at: Instant,
        decode_submitted_at: Instant,
    ) -> Self {
        Self {
            sequence,
            pts,
            socket_received_at,
            decode_submitted_at,
            decode_output_at: None,
            copy_finished_at: None,
            queued_at: None,
            ui_taken_at: None,
            ui_ready_at: None,
        }
    }

    pub fn elapsed_ms(start: Instant, end: Instant) -> f64 {
        end.saturating_duration_since(start).as_secs_f64() * 1000.0
    }
}

pub struct MediaPacket {
    data: Vec<u8>,
    pts: Option<i64>,
    is_config: bool,
    is_key_frame: bool,
    session: Option<MediaSession>,
    received_at: Instant,
}

#[derive(Debug, Clone, Copy)]
pub struct MediaSession {
    pub width: u32,
    pub height: u32,
    pub is_client_resize: bool,
}

impl MediaPacket {
    pub fn session(&self) -> Option<MediaSession> {
        self.session
    }

    pub fn is_config(&self) -> bool {
        self.is_config
    }

    pub fn data_len(&self) -> usize {
        self.data.len()
    }

    pub fn data(&self) -> &[u8] {
        &self.data
    }

    pub fn pts(&self) -> Option<i64> {
        self.pts
    }

    pub fn received_at(&self) -> Instant {
        self.received_at
    }

    fn ffmpeg_packet(data: Vec<u8>, pts: Option<i64>, is_key_frame: bool) -> Packet {
        let mut packet = Packet::copy(&data);
        packet.set_pts(pts);
        packet.set_dts(pts);

        if is_key_frame {
            packet.set_flags(packet.flags() | packet::Flags::KEY);
        }

        packet
    }

    pub fn into_ffmpeg_packet(self) -> Packet {
        Self::ffmpeg_packet(self.data, self.pts, self.is_key_frame)
    }
}

pub async fn read_media_packet(socket: &mut TcpStream) -> std::result::Result<MediaPacket, String> {
    // 记录读取一包媒体数据的墙钟时间（含网络等待，总量）。
    let _t = crate::perf::timed("net.read_packet");
    // read header
    let mut header: [u8; 12] = [0; 12];
    {
        let _t_header = crate::perf::timed("net.read_header");
        socket
            .read_exact(&mut header)
            .await
            .map_err(|e| format!("{}: {}", t!("scrcpy.failedToReadFrameHeader"), e))?;
    }

    let pts_flags = u64::from_be_bytes(header[0..8].try_into().unwrap());
    let len = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;

    if (pts_flags & SC_PACKET_FLAG_SESSION) != 0 {
        return Ok(MediaPacket {
            data: Vec::new(),
            pts: None,
            is_config: false,
            is_key_frame: false,
            session: Some(MediaSession {
                width: pts_flags as u32,
                height: len as u32,
                is_client_resize: (pts_flags & (1u64 << 32)) != 0,
            }),
            received_at: Instant::now(),
        });
    }

    if len > MAX_MEDIA_PACKET_SIZE {
        return Err(format!(
            "{}: packet too large ({len})",
            t!("scrcpy.failedToReadFrameHeader")
        ));
    }

    // read data（细分：first=首块等待/延迟，body=持续传输/带宽，bytes=吞吐量）
    let mut packet_data = vec![0u8; len];
    {
        let _t_data = crate::perf::timed("net.read_data");
        let first = len.min(FIRST_CHUNK_BYTES);
        {
            let _t_first = crate::perf::timed("net.read_data.first");
            socket
                .read_exact(&mut packet_data[..first])
                .await
                .map_err(|e| format!("{}: {}", t!("scrcpy.failedToReadFrameHeader"), e))?;
        }
        crate::perf::add_value("net.read_data.bytes", first as u64);
        if len > first {
            let _t_body = crate::perf::timed("net.read_data.body");
            socket
                .read_exact(&mut packet_data[first..])
                .await
                .map_err(|e| format!("{}: {}", t!("scrcpy.failedToReadFrameHeader"), e))?;
            crate::perf::add_value("net.read_data.bytes", (len - first) as u64);
        }
    }

    let is_config = (pts_flags & SC_PACKET_FLAG_CONFIG) != 0;
    let pts = if is_config {
        None
    } else {
        Some((pts_flags & SC_PACKET_PTS_MASK) as i64)
    };

    Ok(MediaPacket {
        data: packet_data,
        pts,
        is_config,
        is_key_frame: (pts_flags & SC_PACKET_FLAG_KEY_FRAME) != 0,
        session: None,
        received_at: Instant::now(),
    })
}

// Video Codec Constants
pub const SC_CODEC_ID_H264: u32 = 0x68_32_36_34;
pub const SC_CODEC_ID_H265: u32 = 0x68_32_36_35;
pub const SC_CODEC_ID_AV1: u32 = 0x00_61_76_31;
pub const SC_CODEC_ID_OPUS: u32 = 0x6f_70_75_73;
pub const SC_CODEC_ID_AAC: u32 = 0x00_61_61_63;
pub const SC_CODEC_ID_FLAC: u32 = 0x66_6c_61_63;
pub const SC_CODEC_ID_RAW: u32 = 0x00_72_61_77;

pub struct PacketMerger {
    config: Option<Vec<u8>>,
}

impl PacketMerger {
    pub fn new() -> Self {
        PacketMerger { config: None }
    }

    pub fn merge(&mut self, media_packet: MediaPacket) -> Option<Packet> {
        if media_packet.is_config {
            self.config = Some(media_packet.data);
            return None;
        }

        let Some(config_data) = self.config.take() else {
            return Some(media_packet.into_ffmpeg_packet());
        };

        let mut merged_data = Vec::with_capacity(config_data.len() + media_packet.data.len());
        merged_data.extend_from_slice(&config_data);
        merged_data.extend_from_slice(&media_packet.data);

        Some(MediaPacket::ffmpeg_packet(
            merged_data,
            media_packet.pts,
            media_packet.is_key_frame,
        ))
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum VideoCodec {
    H264,
    H265,
    AV1,
}

impl From<VideoCodec> for codec::Id {
    fn from(codec: VideoCodec) -> Self {
        match codec {
            VideoCodec::H264 => Self::H264,
            VideoCodec::H265 => Self::HEVC,
            VideoCodec::AV1 => Self::AV1,
        }
    }
}

impl fmt::Display for VideoCodec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            VideoCodec::H264 => "h264",
            VideoCodec::H265 => "h265",
            VideoCodec::AV1 => "av1",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AudioCodec {
    Opus,
    Aac,
    Flac,
    Raw,
}

impl From<AudioCodec> for codec::Id {
    fn from(codec: AudioCodec) -> Self {
        match codec {
            AudioCodec::Opus => Self::OPUS,
            AudioCodec::Aac => Self::AAC,
            AudioCodec::Flac => Self::FLAC,
            AudioCodec::Raw => Self::PCM_S16LE,
        }
    }
}

impl fmt::Display for AudioCodec {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            AudioCodec::Opus => "opus",
            AudioCodec::Aac => "aac",
            AudioCodec::Flac => "flac",
            AudioCodec::Raw => "raw",
        };
        write!(f, "{}", s)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AudioSource {
    Output,
    Playback,
    Mic,
}

impl AudioSource {
    pub fn is_playback(self) -> bool {
        matches!(self, Self::Playback)
    }
}

impl fmt::Display for AudioSource {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let s = match self {
            AudioSource::Output => "output",
            AudioSource::Playback => "playback",
            AudioSource::Mic => "mic",
        };
        write!(f, "{}", s)
    }
}

pub struct AudioDecoder {
    pub decoder: decoder::Audio,
    pub codec_id: AudioCodec,
}

impl AudioDecoder {
    pub fn new(codec_id: AudioCodec, config: Option<&[u8]>) -> std::result::Result<Self, String> {
        let codec = decoder::find(codec_id.into())
            .ok_or_else(|| format!("FFmpeg decoder not found: {codec_id}"))?;
        let mut codec_context = codec::Context::new_with_codec(codec);
        configure_audio_decoder_context(&mut codec_context);
        if let Some(config) = config {
            set_decoder_extradata(&mut codec_context, config)?;
        }
        let mut decoder = codec_context.decoder();
        decoder.set_packet_time_base(SC_PACKET_TIME_BASE);
        let audio_decoder = decoder
            .audio()
            .map_err(|e| format!("Failed to open FFmpeg decoder: {e}"))?;

        Ok(Self {
            decoder: audio_decoder,
            codec_id,
        })
    }

    pub fn output_sample_format() -> Sample {
        Sample::F32(ffmpeg_next::format::sample::Type::Packed)
    }
}

fn configure_audio_decoder_context(codec_context: &mut codec::Context) {
    unsafe {
        let raw = codec_context.as_mut_ptr();
        (*raw).sample_rate = SC_AUDIO_SAMPLE_RATE;
        (*raw).ch_layout = ChannelLayout::STEREO.into();
    }
}

fn set_decoder_extradata(
    codec_context: &mut codec::Context,
    config: &[u8],
) -> std::result::Result<(), String> {
    if config.is_empty() {
        return Ok(());
    }

    let allocation_size = config.len() + ffi::AV_INPUT_BUFFER_PADDING_SIZE as usize;
    unsafe {
        let extradata = ffi::av_mallocz(allocation_size);
        if extradata.is_null() {
            return Err("Failed to allocate FFmpeg extradata".to_string());
        }

        std::ptr::copy_nonoverlapping(config.as_ptr(), extradata as *mut u8, config.len());
        let raw = codec_context.as_mut_ptr();
        (*raw).extradata = extradata as *mut u8;
        (*raw).extradata_size = config.len() as i32;
    }

    Ok(())
}

pub struct VideoDecoder {
    pub decoder: decoder::Video,
    pub codec_id: VideoCodec,
    pub width: u32,
    pub height: u32,
    pixel_format: Option<Pixel>,
    pub must_merge_config: bool,
    pub packet_merger: PacketMerger,
    pending_traces: VecDeque<VideoFrameTrace>,
    /// 是否启用 D3D11VA 硬件解码（解码输出为 GPU 纹理帧，需下载到 CPU 后使用）
    hw_decode: bool,
}

impl VideoDecoder {
    pub fn new(codec_id: VideoCodec, width: u32, height: u32) -> std::result::Result<Self, String> {
        let (video_decoder, hw_decode) = open_video_decoder(codec_id)?;

        Ok(Self {
            decoder: video_decoder,
            codec_id,
            width,
            height,
            must_merge_config: matches!(codec_id, VideoCodec::H264 | VideoCodec::H265),
            packet_merger: PacketMerger::new(),
            pixel_format: None,
            pending_traces: VecDeque::with_capacity(16),
            hw_decode,
        })
    }

    /// 若解码输出为 D3D11VA 硬件纹理帧，将其下载为 CPU 软件帧（NV12）；
    /// 软解或其他格式则原样返回。
    pub fn finalize_frame(&self, decoded: frame::Video) -> Option<frame::Video> {
        if !self.hw_decode || !matches!(decoded.format(), Pixel::D3D11 | Pixel::D3D11VA_VLD) {
            return Some(decoded);
        }

        let mut sw = frame::Video::empty();
        let ret = {
            let _t = crate::perf::timed("video.hw_transfer");
            unsafe { ffi::av_hwframe_transfer_data(sw.as_mut_ptr(), decoded.as_ptr(), 0) }
        };
        if ret < 0 {
            log::warn!(
                "[Controller] Failed to download D3D11VA frame: {}",
                ffmpeg_next::Error::from(ret)
            );
            return None;
        }
        Some(sw)
    }

    pub fn track_packet(&mut self, trace: VideoFrameTrace) {
        self.pending_traces.push_back(trace);
        while self.pending_traces.len() > 32 {
            self.pending_traces.pop_front();
        }
    }

    pub fn take_trace(&mut self, pts: Option<i64>) -> Option<VideoFrameTrace> {
        if let Some(pts) = pts
            && let Some(index) = self
                .pending_traces
                .iter()
                .position(|trace| trace.pts == Some(pts))
        {
            return self.pending_traces.remove(index);
        }
        self.pending_traces.pop_front()
    }

    pub fn update(&mut self, decoded: &frame::Video) -> std::result::Result<bool, String> {
        let width = decoded.width();
        let height = decoded.height();
        let format = decoded.format();

        if width != self.width || height != self.height || self.pixel_format != Some(format) {
            self.width = width;
            self.height = height;
            self.pixel_format = Some(format);

            Ok(true)
        } else {
            Ok(false)
        }
    }
}

fn set_low_delay_flag(codec_context: &mut codec::Context) {
    let flags = unsafe {
        let raw_flags = (*codec_context.as_mut_ptr()).flags;
        let flags = codec::Flags::from_bits(raw_flags as std::ffi::c_uint)
            .unwrap_or(codec::Flags::empty());
        flags | codec::Flags::LOW_DELAY
    };
    codec_context.set_flags(flags);
}

/// 打开视频解码器：优先尝试 D3D11VA 硬件解码（Windows + H.264/HEVC），
/// 任一环节失败则回退到软件解码。返回 (解码器, 是否启用硬解)。
fn open_video_decoder(
    codec_id: VideoCodec,
) -> std::result::Result<(decoder::Video, bool), String> {
    let codec = decoder::find(codec_id.into())
        .ok_or_else(|| format!("FFmpeg decoder not found: {codec_id}"))?;

    #[cfg(target_os = "windows")]
    if matches!(codec_id, VideoCodec::H264 | VideoCodec::H265) {
        if let Some(mut hw_device_ctx) = create_d3d11va_device_ctx() {
            let mut codec_context = codec::Context::new_with_codec(codec);
            set_low_delay_flag(&mut codec_context);
            unsafe {
                (*codec_context.as_mut_ptr()).hw_device_ctx = ffi::av_buffer_ref(hw_device_ctx);
                ffi::av_buffer_unref(&mut hw_device_ctx);
            }
            match codec_context.decoder().video() {
                Ok(video_decoder) => {
                    log::info!("[Controller] D3D11VA hardware decode enabled for {codec_id}");
                    return Ok((video_decoder, true));
                }
                Err(e) => {
                    log::warn!(
                        "[Controller] D3D11VA decoder open failed ({e}), fallback to software decode"
                    );
                }
            }
        } else {
            log::warn!("[Controller] D3D11VA hwdevice init failed, fallback to software decode");
        }
    }

    let mut codec_context = codec::Context::new_with_codec(codec);
    set_low_delay_flag(&mut codec_context);
    let video_decoder = codec_context
        .decoder()
        .video()
        .map_err(|e| format!("Failed to open FFmpeg decoder: {e}"))?;
    Ok((video_decoder, false))
}

/// 创建 D3D11VA 硬件设备上下文（返回的引用由调用方负责释放）。
#[cfg(target_os = "windows")]
fn create_d3d11va_device_ctx() -> Option<*mut ffi::AVBufferRef> {
    let mut hw_device_ctx = std::ptr::null_mut();
    let ret = unsafe {
        ffi::av_hwdevice_ctx_create(
            &mut hw_device_ctx,
            ffi::AVHWDeviceType::AV_HWDEVICE_TYPE_D3D11VA,
            std::ptr::null(),
            std::ptr::null_mut(),
            0,
        )
    };
    if ret < 0 {
        None
    } else {
        Some(hw_device_ctx)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct YuvPlaneLayout {
    pub y_width: u32,
    pub y_height: u32,
    pub uv_width: u32,
    pub uv_height: u32,
}

impl YuvPlaneLayout {
    pub fn new(width: u32, height: u32) -> Self {
        Self {
            y_width: width,
            y_height: height,
            uv_width: width.div_ceil(2),
            uv_height: height.div_ceil(2),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct YuvColorInfo {
    pub matrix: YuvMatrix,
    pub range: YuvRange,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum YuvMatrix {
    Bt601,
    Bt709,
    Bt2020,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum YuvRange {
    Limited,
    Full,
}

pub enum VideoMsg {
    Yuv420p {
        y: Vec<u8>,
        u: Vec<u8>,
        v: Vec<u8>,
        width: u32,
        height: u32,
        planes: YuvPlaneLayout,
        color: YuvColorInfo,
        trace: Option<VideoFrameTrace>,
    },
    Nv12 {
        y: Vec<u8>,
        uv: Vec<u8>,
        width: u32,
        height: u32,
        planes: YuvPlaneLayout,
        color: YuvColorInfo,
        trace: Option<VideoFrameTrace>,
    },
    Close,
}

impl VideoMsg {
    pub fn is_video_frame(&self) -> bool {
        matches!(self, Self::Yuv420p { .. } | Self::Nv12 { .. })
    }

    pub fn trace_mut(&mut self) -> Option<&mut VideoFrameTrace> {
        match self {
            Self::Yuv420p { trace, .. } | Self::Nv12 { trace, .. } => trace.as_mut(),
            Self::Close => None,
        }
    }
}
