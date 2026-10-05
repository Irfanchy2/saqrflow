'use client'
import { useEffect, useRef, useState } from 'react'

/**
 * Login hero: a slowly turning steel gear and I-beam (the company's trade) rendered with three.js.
 * Loaded lazily after the form is interactive; skipped for reduced motion, no WebGL, or small screens (static art instead).
 */
export function SteelHero() {
  const host = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(false)
  useEffect(() => {
    const el = host.current; if (!el) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const small = !matchMedia('(min-width: 1024px)').matches
    const gl = (() => { try { return !!document.createElement('canvas').getContext('webgl2') } catch { return false } })()
    if (reduce || small || !gl) return
    let stop = () => {}
    let cancelled = false
    const idle = (cb: () => void) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(cb, { timeout: 1200 }) : setTimeout(cb, 300))
    idle(async () => {
      const THREE = await import('three')
      if (cancelled || !host.current) return
      const w = () => el.clientWidth, h = () => el.clientHeight
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' })
      renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(w(), h())
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      el.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-hidden', 'true')
      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(35, w() / h(), 0.1, 100); camera.position.set(0, 0.4, 11)

      // studio lighting tuned for brushed steel
      scene.add(new THREE.HemisphereLight(0xbcd3ff, 0x0b1020, 1.1))
      const key = new THREE.DirectionalLight(0xffffff, 2.4); key.position.set(4, 6, 6); scene.add(key)
      const rim = new THREE.DirectionalLight(0x6ea8ff, 2.2); rim.position.set(-6, -2, -4); scene.add(rim)
      const warm = new THREE.PointLight(0xff6a3d, 30, 12); warm.position.set(-2.5, -2, 2.5); scene.add(warm)

      const steel = new THREE.MeshStandardMaterial({ color: 0xb8c2cf, metalness: 0.92, roughness: 0.32 })
      const red = new THREE.MeshStandardMaterial({ color: 0xc8302c, metalness: 0.6, roughness: 0.38 })

      // gear: toothed outline with a bore, extruded and bevelled
      const gearShape = (teeth: number, r: number, depth: number) => {
        const s = new THREE.Shape()
        for (let i = 0; i < teeth * 4; i++) {
          const a = (i / (teeth * 4)) * Math.PI * 2, rr = i % 4 < 2 ? r + depth : r
          i === 0 ? s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
        }
        const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.38, 0, Math.PI * 2, true); s.holes.push(hole)
        return s
      }
      const extrude = { depth: 0.5, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.05, bevelSegments: 2, curveSegments: 24 }
      const gear = new THREE.Mesh(new THREE.ExtrudeGeometry(gearShape(14, 1.6, 0.28), extrude), red); gear.geometry.center()
      gear.position.set(-1.2, 0.9, 0)
      const gear2 = new THREE.Mesh(new THREE.ExtrudeGeometry(gearShape(9, 0.95, 0.24), extrude), steel); gear2.geometry.center()
      gear2.position.set(1.25, 2.05, -0.3)

      // I-beam profile, extruded along its length
      const ib = new THREE.Shape(), fw = 1.1, ft = 0.16, wt = 0.12, hh = 1.2
      ib.moveTo(-fw / 2, -hh / 2); ib.lineTo(fw / 2, -hh / 2); ib.lineTo(fw / 2, -hh / 2 + ft); ib.lineTo(wt / 2, -hh / 2 + ft); ib.lineTo(wt / 2, hh / 2 - ft)
      ib.lineTo(fw / 2, hh / 2 - ft); ib.lineTo(fw / 2, hh / 2); ib.lineTo(-fw / 2, hh / 2); ib.lineTo(-fw / 2, hh / 2 - ft); ib.lineTo(-wt / 2, hh / 2 - ft)
      ib.lineTo(-wt / 2, -hh / 2 + ft); ib.lineTo(-fw / 2, -hh / 2 + ft); ib.closePath()
      const beam = new THREE.Mesh(new THREE.ExtrudeGeometry(ib, { depth: 6, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 }), steel); beam.geometry.center()
      beam.rotation.set(0.35, 0.9, 0.15); beam.position.set(0.3, -1.6, -0.5)

      // welding sparks
      const N = 160, pos = new Float32Array(N * 3), vel = new Float32Array(N * 3), life = new Float32Array(N)
      const spawn = (i: number) => { pos.set([-0.5, -1.2, 0.6], i * 3); vel.set([(Math.random() - 0.3) * 0.06, Math.random() * 0.07, (Math.random() - 0.5) * 0.05], i * 3); life[i] = Math.random() }
      for (let i = 0; i < N; i++) spawn(i)
      const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3))
      const sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffb35c, size: 0.05, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }))
      const group = new THREE.Group(); group.add(gear, gear2, beam, sparks); group.scale.setScalar(0.6); group.position.set(1.7, 1.55, 0); scene.add(group)

      let mx = 0, my = 0, raf = 0, visible = true
      const onMove = (e: PointerEvent) => { const r = el.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5 }
      const onResize = () => { renderer.setSize(w(), h()); camera.aspect = w() / h(); camera.updateProjectionMatrix() }
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting })
      const onVis = () => { visible = !document.hidden }
      el.addEventListener('pointermove', onMove); addEventListener('resize', onResize); io.observe(el); document.addEventListener('visibilitychange', onVis)
      const clock = new THREE.Clock()
      const tick = () => {
        raf = requestAnimationFrame(tick)
        if (!visible) return
        const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime
        gear.rotation.z += dt * 0.35; gear2.rotation.z -= dt * 0.35 * (14 / 9)
        beam.rotation.y = 0.9 + Math.sin(t * 0.3) * 0.12
        group.rotation.y += (mx * 0.5 - group.rotation.y) * 0.04; group.rotation.x += (my * 0.3 - group.rotation.x) * 0.04
        group.position.y = 1.55 + Math.sin(t * 0.6) * 0.08
        for (let i = 0; i < N; i++) {
          life[i] += dt * 0.9; if (life[i] > 1) { spawn(i); life[i] = 0 }
          vel[i * 3 + 1] -= dt * 0.12
          pos[i * 3] += vel[i * 3]; pos[i * 3 + 1] += vel[i * 3 + 1]; pos[i * 3 + 2] += vel[i * 3 + 2]
        }
        sg.attributes.position.needsUpdate = true
        warm.intensity = 24 + Math.random() * 14
        renderer.render(scene, camera)
      }
      tick(); setLive(true)
      stop = () => {
        cancelAnimationFrame(raf); io.disconnect(); el.removeEventListener('pointermove', onMove); removeEventListener('resize', onResize); document.removeEventListener('visibilitychange', onVis)
        scene.traverse(o => { const m = o as any; m.geometry?.dispose?.(); m.material?.dispose?.() })
        renderer.dispose(); renderer.domElement.remove()
      }
    })
    return () => { cancelled = true; stop() }
  }, [])
  return <div ref={host} className="absolute inset-0">
    {/* static art: shown until WebGL is ready, and instead of it on mobile / reduced motion */}
    <svg viewBox="0 0 200 200" aria-hidden className={`absolute left-[66%] top-[28%] h-56 w-56 -translate-x-1/2 -translate-y-1/2 text-white/10 transition-opacity duration-700 ${live ? 'opacity-0' : 'opacity-100'}`}>
      <path fill="currentColor" d={Array.from({ length: 56 }, (_, i) => { const a = (i / 56) * Math.PI * 2, r = i % 4 < 2 ? 92 : 78; return `${i ? 'L' : 'M'}${100 + Math.cos(a) * r} ${100 + Math.sin(a) * r}` }).join(' ') + 'Z M130 100 A30 30 0 1 0 70 100 A30 30 0 1 0 130 100Z'} fillRule="evenodd" />
    </svg>
  </div>
}
