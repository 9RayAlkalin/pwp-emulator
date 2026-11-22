-- Phigros 2.5.1 ARM64 YukifuriEffect.Update RVA 0x38ec1f0, image base 0.
-- libil2cpp.so SHA256: 1cbb947e521a08311c0e7d5f5b063ecd2a2d46b019e7c01701a674949f8bfa90
-- ABI arm64-v8a; IDA EA=RVA with image base 0x0.
-- Evidence and sample hashes: research/notes/april-fools-2.5.1.md.
-- pwp:spectrum-hz=30
local face, step, last_perfect = '', -1, 0
local pending = -1
local function clamp(x) return math.max(0, math.min(1, x)) end
local function round(x)
    local n = math.floor(x)
    return n + ((x - n > .5 or (x - n == .5 and n % 2 == 1)) and 1 or 0)
end
function on_reset(state)
    face, step, pending, last_perfect = '', -1, -1, state.perfect
    pwp.display({level = 'lN  Lv.I2', combo = ''})
end
function on_hit(note, grade, state)
    pending = (grade == 'perfect' and 2) or (grade == 'good' and 1) or 0
end
function on_update(dt, state)
    local t = state.time
    local blend = 1 - (1 - clamp((t - 86.15385) / .8)) ^ 3
    local total = round(305 + (state.total - 305) * blend)
    local spectrum = state.spectrum or 0
    local energy = clamp(math.log(math.sqrt(spectrum) * 9 + 1, 10) * 16)
    local beat = clamp(1.3 / (1 + 2.7182817459106445 ^ (2 - 6 * energy)) - .15)
    -- Hide the near-silent floor seen in pwp. The 226.45 s decoded tail
    -- measures about 1.04e-11; this visual cutoff is not a native constant.
    if spectrum <= 2e-11 then beat = 0 end
    local progress = t / 112.9485 * (1 - blend) + beat * blend
    local now_step = math.modf((t - 167.17943) / .512825)
    if now_step >= 0 and now_step <= 31 then
        if now_step ~= step then
            step = now_step
            if step % 8 == 0 then face, pending = '(⊙o⊙)', -1 end
            if step % 8 == 1 then face = '(⊙ω⊙)' end
        end
        if state.autoplay and state.perfect > last_perfect then pending = 2 end
        if pending >= 0 then
            face = ({[0]='(⊙﹏⊙;)', [1]='(＾ω＾)', [2]='Ｏ(≧▽≦)Ｏ'})[pending]
            pending = -1
        end
    else face = '' end
    last_perfect = state.perfect
    local score = total > 0 and round(((state.perfect + state.good * .65) * 900000 + state.maxCombo * 100000) / total) or 0
    pwp.display({score=score, combo=face, progress=progress, level=t > 86.15385 and 'SP  Lv.?' or 'lN  Lv.I2'})
end
