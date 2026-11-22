-- 2D reconstruction of the APK Snow/Smoke emitters. Native prefab: rate 5/s,
-- lifetime 5s; snow size .2..6, speed2..5, smoke size40..60/speed5.
-- Seed and projection are deterministic adaptations, not Unity GPU equivalence.
local particles, next_birth, previous = {}, 0, 0
function april_particles_reset() particles,next_birth,previous={},0,0 end
local function sample(n,k) return ((n*16807+k*48271)%2147483647)%10007/10007 end
function april_particles(state,cold,hot)
    local t=state.time
    if t<previous then april_particles_reset() end
    local first=math.max(next_birth,math.floor((t-5)*5)+1)
    local last=math.floor(t*5)
    for birth=first,last do
        if cold or hot then particles[#particles+1]={id=birth,time=birth/5,cold=cold} end
    end
    next_birth=last+1;previous=t
    local aspect=(state.width or 16)/(state.height or 9)
    for i=#particles,1,-1 do
        local p=particles[i];local age=t-p.time;local id='particle:'..p.id
        if age>5 then pwp.element(id);table.remove(particles,i)
        else
            local u,v=sample(p.id,1),sample(p.id,2)
            local size=p.cold and (.02+.04*v) or (4+2*v)
            local y=p.cold and (-.1+age*(.2+.3*v)) or (.5+math.sin(p.id)*.2)
            local alpha=p.cold and math.min(1,age*2,(5-age)*2) or .08*math.min(1,age,(5-age))
            pwp.element(id,{texture=p.cold and 'particles/snow.png' or 'particles/smoke.png',
                x=u,y=y,width=size/aspect,height=size,rotation=p.id*137+age*(15+30*v),alpha=alpha})
        end
    end
end
