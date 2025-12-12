import React, { Suspense } from 'react'
import { Canvas } from '@react-three/fiber'
import { FluidScene } from './FluidScene'
import './index.css' // Make sure you import the CSS

function App() {
  return (
    <div className="main-container">
      
      {/* 1. Canvas Layer: Fixed Background */}
      <div className="canvas-container">
        <Canvas
          camera={{ position: [0, 0, 1], fov: 75 }}
          dpr={[1, 2]}
          gl={{ 
            antialias: true, 
            alpha: true,
            // Optimization: Preserves buffers for the fluid trail effect
            preserveDrawingBuffer: true 
          }}
          // CRITICAL: This allows the canvas to track mouse events
          // on the whole page, even if the canvas is behind text.
          eventSource={document.getElementById('root')}
          eventPrefix="client"
        >
          <Suspense fallback={null}>
            <FluidScene />
          </Suspense>
        </Canvas>
      </div>

      {/* 2. HTML Content Layer: Foreground */}
      <div className="layout">
        <header className="header">
          <div className="logo">LUSION</div>
          <div className="nav-group">
            <button className="nav-btn">_</button>
            <button className="nav-btn primary">LET'S TALK</button>
            <button className="nav-btn">MENU ••</button>
          </div>
        </header>

        <main className="hero">
          <h1 className="hero-title">
            Beyond Visions<br />
            Within Reach
          </h1>
          <div className="hero-description">
            <p>
              Lusion is a digital production studio that brings your ideas to life
              through visually captivating designs and interactive experiences.
              With our talented team, we push the boundaries by solving
              complex problems, delivering tailored solutions that exceed
              expectations.
            </p>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App