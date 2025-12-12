import React, { useRef, useMemo, useEffect, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useFBO } from '@react-three/drei';
import * as THREE from 'three';

// -----------------------------------------------------------------------------
// COMMON SHADER
// -----------------------------------------------------------------------------
const commonVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// -----------------------------------------------------------------------------
// SIMULATION SHADER (Physics)
// -----------------------------------------------------------------------------
const simFragmentShader = `
  uniform sampler2D uTexture;
  uniform vec2 uMouse;
  uniform vec2 uPrevMouse;
  uniform float uAspectRatio;
  uniform float uTime;
  uniform float uVelocity; // NEW: Controls life based on movement
  
  varying vec2 vUv;

  vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
  float snoise(vec2 v){
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
             -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1;
    i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
    + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float distToSegment(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp( dot(pa,ba)/dot(ba,ba), 0.0, 1.0 );
    return length( pa - ba*h );
  }

  void main() {
    vec2 uv = vUv;
    
    // 1. ADVECTION (Movement)
    // We only swirl if the fluid exists.
    float t = uTime * 0.2;
    vec2 flow = vec2(
        snoise(uv * 3.0 + t) * 2.0, 
        snoise(uv * 3.0 - t + 30.0) * 2.0
    ) * 0.003; 
    
    vec4 oldState = texture2D(uTexture, uv - flow);
    
    // 2. DYNAMIC DECAY (Stop when not moving)
    // If velocity is high, decay slowly (long trails).
    // If velocity is low (mouse stopped), decay FAST (0.85).
    float targetDecay = mix(0.85, 0.99, smoothstep(0.0, 0.01, uVelocity));
    
    vec4 newState = oldState * targetDecay; 
    
    // 3. MOUSE INPUT
    // Only add density if the mouse is moving significantly
    if(uVelocity > 0.0001) {
        vec2 aspect = vec2(uAspectRatio, 1.0);
        vec2 uvAspect = uv * aspect;
        vec2 mouseAspect = uMouse * aspect;
        vec2 prevMouseAspect = uPrevMouse * aspect;
        
        float dist = distToSegment(uvAspect, prevMouseAspect, mouseAspect);
        
        // Ribbon brush
        float radius = 0.05; 
        float intensity = smoothstep(radius, 0.0, dist);
        
        newState.r = clamp(newState.r + intensity, 0.0, 1.0);
    }
    
    gl_FragColor = newState;
  }
`;

// -----------------------------------------------------------------------------
// DISPLAY SHADER (Prism / Spectral Refraction)
// -----------------------------------------------------------------------------
const displayFragmentShader = `
  uniform sampler2D uFluid;
  uniform float uTime;
  uniform vec2 uTexelSize;
  
  varying vec2 vUv;

  // -- SPECTRAL PALETTE --
  // This generates the Pink -> White -> Cyan gradient (Lusion style)
  vec3 getSpectralColor(float t) {
      // High brightness base (Pastel)
      vec3 a = vec3(0.8, 0.8, 0.8); 
      vec3 b = vec3(0.2, 0.2, 0.2); 
      vec3 c = vec3(1.0, 1.0, 1.0); 
      // This phase shift creates the specific rainbow order
      vec3 d = vec3(0.0, 0.33, 0.67); 
      
      return a + b * cos(6.28318 * (c * t + d));
  }

  void main() {
    // Sample with simple blur to smooth artifacts
    float density = texture2D(uFluid, vUv).r;
    
    if(density < 0.005) discard;

    // -- 1. PRISM REFRACTION --
    // We calculate the slope (normal)
    float dX = texture2D(uFluid, vUv + vec2(uTexelSize.x, 0.0)).r - texture2D(uFluid, vUv - vec2(uTexelSize.x, 0.0)).r;
    float dY = texture2D(uFluid, vUv + vec2(0.0, uTexelSize.y)).r - texture2D(uFluid, vUv - vec2(0.0, uTexelSize.y)).r;
    
    vec3 normal = normalize(vec3(-dX * 10.0, -dY * 10.0, 1.0));
    float refractionStrength = length(vec2(dX, dY));
    
    // -- 2. CHROMATIC ABERRATION (The "Prism" Effect) --
    // We shift the color channels based on the refraction.
    // This creates the red/blue fringing at the edges.
    
    vec3 spectralColor;
    
    // Calculate "Thickness" (t) for the rainbow palette
    // Adding uTime makes the colors ripple slightly
    float t = density * 0.8 + refractionStrength * 2.0; 
    
    // Shift the palette lookup for each channel (RGB split)
    spectralColor.r = getSpectralColor(t + 0.02).r; // Red shifted
    spectralColor.g = getSpectralColor(t + 0.00).g; // Green center
    spectralColor.b = getSpectralColor(t - 0.02).b; // Blue shifted
    
    // -- 3. SPECULAR (White "Oil" Sheen) --
    vec3 lightDir = normalize(vec3(0.5, 1.0, 1.0));
    float spec = pow(max(0.0, dot(normal, lightDir)), 30.0);
    
    // -- 4. COMPOSITION --
    
    // Mix the spectral color with pure white based on density
    // Low density = Colorful (Rainbow edges)
    // High density = White/Silver (Thick oil)
    vec3 finalColor = mix(spectralColor, vec3(1.0, 1.0, 1.0), density * 0.4);
    
    // Add the specular highlight
    finalColor += spec * 0.6;
    
    // -- 5. ALPHA --
    // Base transparency (Very clear)
    float alpha = density * 0.05; 
    
    // Add visibility at edges (Refraction)
    alpha += refractionStrength * 1.5;
    
    // Add visibility at highlights
    alpha += spec;
    
    // Boost the colors at low density so the pink/cyan tails are visible
    alpha += density * 0.5 * (1.0 - density);
    
    // Clamp
    alpha = clamp(alpha, 0.0, 0.9);
    
    // Smooth edges
    alpha *= smoothstep(0.0, 0.05, density);

    gl_FragColor = vec4(finalColor, alpha);
  }
`;

export const FluidScene = () => {
  const { size, viewport, gl } = useThree();
  const [isActive, setIsActive] = useState(false);
  
  const simParams = {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  };
  
  const bufferA = useFBO(size.width, size.height, simParams);
  const bufferB = useFBO(size.width, size.height, simParams);
  
  const simScene = useMemo(() => new THREE.Scene(), []);
  const simCamera = useMemo(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), []);
  const simMaterial = useRef();

  useEffect(() => {
    const geometry = new THREE.PlaneGeometry(2, 2);
    const material = new THREE.ShaderMaterial({
      vertexShader: commonVertexShader,
      fragmentShader: simFragmentShader,
      uniforms: {
        uTexture: { value: null },
        uMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uPrevMouse: { value: new THREE.Vector2(0.5, 0.5) },
        uAspectRatio: { value: size.width / size.height },
        uTime: { value: 0 },
        uVelocity: { value: 0 },
      }
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    simScene.add(mesh);
    simMaterial.current = material;
    
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [size, simScene]);

  const mouseRef = useRef(new THREE.Vector2(0.5, 0.5));
  const prevMouseRef = useRef(new THREE.Vector2(0.5, 0.5));
  const frameCount = useRef(0);
  const idleFrames = useRef(0);
  const displayRef = useRef();
  
  useFrame((state) => {
    const { pointer, clock } = state;
    const time = clock.getElapsedTime();
    
    const currentMouse = new THREE.Vector2(
      (pointer.x + 1) * 0.5,
      (pointer.y + 1) * 0.5
    );
    
    if (frameCount.current === 0) {
      prevMouseRef.current.copy(currentMouse);
      mouseRef.current.copy(currentMouse);
    }
    
    // Calculate Velocity (Distance moved this frame)
    // We multiply by 100 to get a usable number for shaders
    const velocity = currentMouse.distanceTo(prevMouseRef.current);
    
    // STOPPING LOGIC:
    // If velocity is near zero, we count idle frames.
    // If idle for too long, we stop rendering to save GPU.
    if (velocity < 0.0001) {
        idleFrames.current++;
        if (idleFrames.current > 150) return; // Stop after ~2.5 seconds of stillness
    } else {
        idleFrames.current = 0;
    }

    if (simMaterial.current) {
      simMaterial.current.uniforms.uMouse.value.copy(currentMouse);
      simMaterial.current.uniforms.uPrevMouse.value.copy(prevMouseRef.current);
      simMaterial.current.uniforms.uTime.value = time;
      simMaterial.current.uniforms.uAspectRatio.value = size.width / size.height;
      
      // Pass velocity to shader to control Decay (Life span)
      simMaterial.current.uniforms.uVelocity.value = velocity;
      
      const inputBuffer = frameCount.current % 2 === 0 ? bufferB : bufferA;
      const outputBuffer = frameCount.current % 2 === 0 ? bufferA : bufferB;
      
      simMaterial.current.uniforms.uTexture.value = inputBuffer.texture;
      
      gl.setRenderTarget(outputBuffer);
      gl.render(simScene, simCamera);
      gl.setRenderTarget(null); 
      
      if (displayRef.current) {
         displayRef.current.material.uniforms.uFluid.value = outputBuffer.texture;
         displayRef.current.material.uniforms.uTime.value = time;
         displayRef.current.material.uniforms.uTexelSize.value.set(1/size.width, 1/size.height);
      }
    }
    
    prevMouseRef.current.copy(currentMouse);
    mouseRef.current.copy(currentMouse);
    frameCount.current++;
  });

  return (
    <mesh 
      ref={displayRef} 
      scale={[viewport.width, viewport.height, 1]}
      onPointerEnter={() => setIsActive(true)}
      onPointerLeave={() => setIsActive(false)}
    >
      <planeGeometry args={[1, 1]} /> 
      <shaderMaterial
        vertexShader={commonVertexShader}
        fragmentShader={displayFragmentShader}
        uniforms={{
          uFluid: { value: null },
          uTime: { value: 0 },
          uTexelSize: { value: new THREE.Vector2(0, 0) }
        }}
        transparent={true}
        depthWrite={false}
        // Additive or Normal blending work. 
        // For "Light" colors, NormalBlending usually looks more like physical oil.
        blending={THREE.NormalBlending}
      />
    </mesh>
  );
};