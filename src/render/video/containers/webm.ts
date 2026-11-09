/* ---- 最小 WebM 写入器 ----
   EBML 基本元素就这几样，全部「已知尺寸」写出。IDs 按规范字节直接列。 */
const wb_utf8 = new TextEncoder();
const WEBM_ID = {
    ebml: [0x1A, 0x45, 0xDF, 0xA3],
    ebml_version: [0x42, 0x86], ebml_read_version: [0x42, 0xF7],
    ebml_max_id: [0x42, 0xF2], ebml_max_size: [0x42, 0xF3],
    doctype: [0x42, 0x82], doctype_version: [0x42, 0x87], doctype_read_version: [0x42, 0x85],
    segment: [0x18, 0x53, 0x80, 0x67],
    info: [0x15, 0x49, 0xA9, 0x66], timecode_scale: [0x2A, 0xD7, 0xB1],
    muxing_app: [0x4D, 0x80], writing_app: [0x57, 0x41], duration: [0x44, 0x89],
    tracks: [0x16, 0x54, 0xAE, 0x6B], track_entry: [0xAE], track_number: [0xD7],
    track_uid: [0x73, 0xC5], track_type: [0x83], flag_lacing: [0x9C],
    codec_id: [0x86], codec_private: [0x63, 0xA2], codec_delay: [0x56, 0xAA],
    seek_pre_roll: [0x56, 0xBB], default_duration: [0x23, 0xE3, 0x83],
    video: [0xE0], flag_interlaced: [0x9A], pixel_width: [0xB0], pixel_height: [0xBA],
    audio: [0xE1], sampling_freq: [0xB5], channels: [0x9F],
    cluster: [0x1F, 0x43, 0xB6, 0x75], timecode: [0xE7], simple_block: [0xA3],
    cues: [0x1C, 0x53, 0xBB, 0x6B], cue_point: [0xBB], cue_time: [0xB3],
    cue_positions: [0xB7], cue_track: [0xF7], cue_cluster_pos: [0xF1]
};

/* 拼接若干 Uint8Array（可嵌套数组 / 跳过 null），一次性分配 */
const cat_bytes = (...arrs) => {
    const flat: Uint8Array[] = [];
    const push = a => {
        if (a == null) return;
        if (a instanceof Uint8Array) { flat.push(a); return; }
        for (const x of a) push(x);
    };
    push(arrs);
    let n = 0;
    for (const b of flat) n += b.length;
    const out = new Uint8Array(n);
    let off = 0;
    for (const b of flat) { out.set(b, off); off += b.length; }
    return out;
};

/* EBML 变长整数（元素尺寸、SimpleBlock 里的轨道号）。全 1 模式是「未知尺寸」保留值，
   所以可用上界是 2^(7·len)−2，按此选最短长度。 */
const wb_vint = v => {
    for (let len = 1; len <= 8; len++) {
        const max = Math.pow(2, 7 * len) - 1;
        if (v < max) {
            const out = new Uint8Array(len);
            let x = v;
            for (let i = len - 1; i >= 0; i--) { out[i] = x & 0xff; x = Math.floor(x / 256); }
            out[0] |= 1 << (8 - len);
            return out;
        }
    }
    throw new Error("webm: vint 溢出");
};

const wb_uint = n => {
    const out: number[] = [];
    let x = Math.max(0, Math.floor(n));
    do { out.unshift(x & 0xff); x = Math.floor(x / 256); } while (x > 0);
    return Uint8Array.from(out);
};

const wb_f64 = n => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, n);
    return b;
};

const wb_el = (id, ...payload) => {
    const body = cat_bytes(...payload);
    return cat_bytes(Uint8Array.from(id), wb_vint(body.length), body);
};

/* 写入器：add_video/add_audio 收 EncodedVideoChunk/EncodedAudioChunk（按时间戳归并
   入簇，见导出驱动的 pump），finish 出 Blob。
   簇切换：>4s / >4MB / 遇视频关键帧（导出每 2s 一个）——
   簇内 SimpleBlock 的相对时间戳是 int16 毫秒，4s 远在 ±32.7s 限内。
   frame_ns = 视频帧时长（ns），写进 TrackEntry/DefaultDuration —— 没有它
   ffprobe/播放器推不出帧率（实测 r_frame_rate 会变成 1000/1 这种怪值）。 */
export const webm_writer = ({ width, height, video_codec, frame_ns, audio, duration_ms }) => {
    const clusters: Uint8Array<ArrayBuffer>[] = [];
    const cues: { t: number; cluster: number }[] = [];
    let cur: { ts: number; blocks: Uint8Array<ArrayBuffer>[]; size: number } | null = null;

    const new_cluster = ts => { cur = { ts, blocks: [], size: 0 }; };
    const seal_cluster = () => {
        if (!cur) return;
        clusters.push(wb_el(WEBM_ID.cluster,
            wb_el(WEBM_ID.timecode, wb_uint(cur.ts)), ...cur.blocks));
        cur = null;
    };
    const add_block = (track, ts_ms, key, data) => {
        if (!cur) new_cluster(ts_ms);
        const span = ts_ms - cur!.ts;
        if (span > 4000 || cur!.size > (4 << 20) || (track === 1 && key && cur!.blocks.length && span > 0)) {
            seal_cluster();
            new_cluster(ts_ms);
        }
        const head = new Uint8Array(4);
        head[0] = 0x80 | track;                                   // 轨道号 vint（1/2 均单字节）
        new DataView(head.buffer).setInt16(1, ts_ms - cur!.ts);
        head[3] = key ? 0x80 : 0;
        // ★ SimpleBlock = A3 + 尺寸 + [轨道号][int16 相对时间][flags][数据]。
        //   第一版漏了 wb_el 这层包装，把裸 payload 塞进簇 —— 文件结构自洽（尺寸都对），
        //   ffmpeg 也能认出轨道/时长，但一个 Block 都解不出来
        //   （_analysis\ebml_check.py 与 ffprobe 的 “0x00 at pos …” 警告就是这来的）。
        const blk = wb_el(WEBM_ID.simple_block, head, data);
        cur!.blocks.push(blk);
        cur!.size += blk.length;
        if (track === 1 && key) cues.push({ t: ts_ms, cluster: clusters.length });
    };
    const chunk_bytes = chunk => {
        const b = new Uint8Array(chunk.byteLength);
        chunk.copyTo(b);
        return b;
    };

    const finish = () => {
        seal_cluster();
        const info = wb_el(WEBM_ID.info,
            wb_el(WEBM_ID.timecode_scale, wb_uint(1000000)),     // 1 tick = 1ms
            wb_el(WEBM_ID.muxing_app, wb_utf8.encode("PhigrosWebPlayer")),
            wb_el(WEBM_ID.writing_app, wb_utf8.encode("PhigrosWebPlayer")),
            wb_el(WEBM_ID.duration, wb_f64(duration_ms)));
        const tracks_payload = [wb_el(WEBM_ID.track_entry,
            wb_el(WEBM_ID.track_number, wb_uint(1)),
            wb_el(WEBM_ID.track_uid, wb_uint(1)),
            wb_el(WEBM_ID.track_type, wb_uint(1)),
            wb_el(WEBM_ID.flag_lacing, wb_uint(0)),
            wb_el(WEBM_ID.codec_id, wb_utf8.encode(video_codec)),
            wb_el(WEBM_ID.default_duration, wb_uint(frame_ns)),  // ns/帧 → 帧率元数据
            wb_el(WEBM_ID.video,
                wb_el(WEBM_ID.flag_interlaced, wb_uint(2)),      // 2 = progressive
                wb_el(WEBM_ID.pixel_width, wb_uint(width)),
                wb_el(WEBM_ID.pixel_height, wb_uint(height))))];
        if (audio) {
            tracks_payload.push(wb_el(WEBM_ID.track_entry,
                wb_el(WEBM_ID.track_number, wb_uint(2)),
                wb_el(WEBM_ID.track_uid, wb_uint(2)),
                wb_el(WEBM_ID.track_type, wb_uint(2)),
                wb_el(WEBM_ID.flag_lacing, wb_uint(0)),
                wb_el(WEBM_ID.codec_id, wb_utf8.encode("A_OPUS")),
                wb_el(WEBM_ID.codec_private, audio.codec_private),
                wb_el(WEBM_ID.codec_delay, wb_uint(audio.codec_delay_ns)),
                wb_el(WEBM_ID.seek_pre_roll, wb_uint(80000000)), // Opus 规范值 80ms
                wb_el(WEBM_ID.audio,
                    wb_el(WEBM_ID.sampling_freq, wb_f64(48000)),
                    wb_el(WEBM_ID.channels, wb_uint(audio.channels)))));
        }
        const tracks = wb_el(WEBM_ID.tracks, ...tracks_payload);

        // Cues 的簇位置 = 相对 Segment 数据起点（Info/Tracks 之后）的字节偏移；
        // 此时所有簇都已封口，尺寸全知
        let off = info.length + tracks.length;
        const cl_off = clusters.map(c => { const o = off; off += c.length; return o; });
        const cues_el = wb_el(WEBM_ID.cues, ...cues.map(q => wb_el(WEBM_ID.cue_point,
            wb_el(WEBM_ID.cue_time, wb_uint(q.t)),
            wb_el(WEBM_ID.cue_positions,
                wb_el(WEBM_ID.cue_track, wb_uint(1)),
                wb_el(WEBM_ID.cue_cluster_pos, wb_uint(cl_off[q.cluster]))))));

        // Segment 头单独写（尺寸 = 其后全部内容）；其余全部作为 Blob 分片拼装，
        // 避免再整体复制一份
        const seg_head = cat_bytes(Uint8Array.from(WEBM_ID.segment), wb_vint(off + cues_el.length));
        const head = wb_el(WEBM_ID.ebml,
            wb_el(WEBM_ID.ebml_version, wb_uint(1)),
            wb_el(WEBM_ID.ebml_read_version, wb_uint(1)),
            wb_el(WEBM_ID.ebml_max_id, wb_uint(4)),
            wb_el(WEBM_ID.ebml_max_size, wb_uint(8)),
            wb_el(WEBM_ID.doctype, wb_utf8.encode("webm")),
            wb_el(WEBM_ID.doctype_version, wb_uint(4)),          // VP9 需要 ≥4（VP8 也兼容）
            wb_el(WEBM_ID.doctype_read_version, wb_uint(2)));
        const blob = new Blob([head, seg_head, info, tracks, ...clusters, cues_el],
                              { type: "video/webm" });
        clusters.length = 0;   // Blob 已复制，释放引用给 GC
        return blob;
    };

    return {
        add_video: chunk => add_block(1, Math.round(chunk.timestamp / 1000),
                                      chunk.type === "key", chunk_bytes(chunk)),
        add_audio: chunk => add_block(2, Math.round(chunk.timestamp / 1000),
                                      true, chunk_bytes(chunk)),
        finish
    };
};

