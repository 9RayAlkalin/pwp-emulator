-- Phigros 2.5.1(77), arm64-v8a, libil2cpp.so; RVA=EA, IDA image base 0x0.
-- SHA256: 1cbb947e521a08311c0e7d5f5b063ecd2a2d46b019e7c01701a674949f8bfa90
-- Native state machine: RemoteConController RVA 0x21802f4/0x21808f8/0x2180df4.
-- Scene colors/remote sprite positions come from the APK prefab; see research notes.
local temperature, mode, power, shown, lock_until, last_time
local color, target, since, volume, target_volume, dead, dead_since, flash
local seed
local power_since
local modes = {'AUTO','Cooling','Heating','Ventilate','Arefaction'}
local segments = {[0]={0,1,2,4,5,6}, {2,5}, {0,2,3,4,6}, {0,2,3,5,6}, {1,2,3,5},
                  {0,1,3,5,6}, {0,1,3,4,5,6}, {0,2,5}, {0,1,2,3,4,5,6}, {0,1,2,3,5,6}}
local function clamp(v) return math.max(0,math.min(1,v)) end
local function lerp(a,b,t) return a+(b-a)*clamp(t) end
local function random3()
    seed = (seed * 48271) % 2147483647
    return seed % 3
end
local function environment(t)
    local cold={.33490568,.74991506,1,1}
    local hot={1,.21672757,.113000035,.8}
    target={}
    for i=1,4 do
        target[i] = temperature < 25 and lerp(cold[i],1,temperature/24) or lerp(1,hot[i],(temperature-25)/15)
    end
    target_volume = (shown and .4 or 1) * (1-clamp((temperature-26)/14))
    since=t
end
function on_reset(state)
    temperature, mode, power, shown, lock_until = 26,1,false,false,0
    seed=25177; color={1,1,1,0}; target={1,1,1,0}; since=-10
    volume,target_volume,dead,dead_since,flash=1,1,nil,0,-10
    last_time=state.time
    power_since=0
    if april_particles_reset then april_particles_reset() end
    pwp.display({combo='',level=april_level or 'IN  Lv.15'})
end
function on_action(action,state)
    local t=state.time
    if dead then return end
    if action=='controller' then
        shown=not shown
        target_volume=target_volume*(shown and .4 or 2.5)
        since=t
        return
    end
    if action=='power' then power=not power;power_since=t
    elseif not power or t<lock_until then return
    elseif action=='mode' then
        mode=mode%5+1
        if mode~=2 and temperature<16 then temperature=16; environment(t) end
    elseif action=='minus' or action=='plus' then
        local delta = (random3()>=1) and 1 or -1
        if action=='minus' then delta=-delta end
        temperature=math.max(0,math.min(40,temperature+delta))
        if mode~=2 and temperature<16 then temperature=16 else environment(t) end
        if temperature==0 and mode==2 then dead,dead_since='cold',t; target={0,.4,1,1};target_volume=0;since=t end
        if temperature==40 then dead,dead_since='hot',t;target={1,0,0,1};since=t end
    else return end
    lock_until=t+.3; flash=t
    pwp.sound('ControlSound_01',1)
end
local function has_segment(n,s)
    for _,v in ipairs(segments[n]) do if v==s then return true end end
    return false
end
local function remote(state)
    -- Native ShowTransform (-6,-2.5,335); CanvasScaler uses reference height 600.
    local aspect=(state.width or 16)/(state.height or 9)
    local angle=25*math.pi/180
    local function position(x,y) return .5+(-.6+(x*math.cos(angle)+y*math.sin(angle))/600)/aspect,
                                            .75+(x*math.sin(angle)-y*math.cos(angle))/600 end
    for i,p in ipairs(remote_parts or {}) do
        local visible=shown
        if p.name=='ScreenBackLight' or p.name=='ON' or p.name=='°C' then visible=visible and power end
        if p.name=='OFF' then visible=visible and not power end
        if p.name=='Light' then visible=visible and state.time-flash<.15 end
        for _,m in ipairs(modes) do if p.name==m then visible=visible and power and p.name==modes[mode] end end
        local number=tonumber(p.name)
        if number then
            local tens=p.digit=='tens'
            visible=visible and power and has_segment(tens and math.floor(temperature/10) or temperature%10,p.segment)
        end
        local x,y=position(p.x,p.y)
        pwp.element('remote:'..i,{texture=p.texture,x=x,y=y,width=p.width/600/aspect,height=p.height/600,
                                rotation=25,alpha=visible and 1 or 0})
    end
    for _,b in ipairs({{'power',8.0468,144.03,46.34,47.33},{'mode',93.79,144.03,47.32,48.33},
                       {'minus',15.205,65.735,64.13,66.76},{'plus',86.782,65.736,60.83,63.33}}) do
        local x,y=position(b[2],b[3])
        pwp.element(b[1],{action=b[1],x=x,y=y,width=b[4]/600/aspect,height=b[5]/600,rotation=25,alpha=shown and 1 or 0})
    end
    -- The native remote is toggled by tapping SongsLevel.
    pwp.element('controller',{action='controller',x=.88,y=.952,width=.22,height=.08})
end
function on_update(dt,state)
    local t=state.time
    -- Fixed 60Hz reconstruction of native recursive current->target lerps.
    -- Repeated paused frames do not advance it; native real frame pacing may differ.
    local stop=math.min(t,since+(dead and 7 or 2))
    local start=math.max(last_time,since)
    local steps=math.max(0,math.floor((stop-since)*60+1e-6)-math.floor((start-since)*60+1e-6))
    for n=1,math.min(steps,420) do
        local f=clamp((start+n/60-since)/(dead and 7 or 2))
        for i=1,4 do color[i]=lerp(color[i],target[i],f) end
        volume=lerp(volume,target_volume,f)
    end
    if t>since+(dead and 7 or 2) then color={table.unpack(target)};volume=target_volume end
    last_time=t
    pwp.screen({color[1]*255,color[2]*255,color[3]*255},color[4])
    pwp.volume(volume)
    local working=power and clamp((t-power_since-.2)/8) or 1-clamp((t-power_since-.5)/5)
    if power_since==0 then working=0 end
    pwp.loop('AirconditionerWorking',working,.4+.3*working)
    pwp.loop('Cooking',clamp((temperature-32)/8),1)
    pwp.loop('IceCracking',temperature<=10 and clamp(1-temperature/10) or 0,1)
    pwp.display({level=string.format('%s  %d°C',april_level or 'IN  Lv.15',temperature)})
    if april_particles then april_particles(state,temperature<=10,temperature>=32) end
    remote(state)
    if dead and t-dead_since>7 then
        if dead=='cold' then pwp.chart('SP') else pwp.finish() end
        dead=nil
    end
end
