/* Example Custom Vehicle Template: Rocket Speedster */

export default {
  id: 'custom_rocket',
  name: 'Rocket Speedster',
  icon: '🚀',
  baseSpeed: 13.0,
  minSlowdownSpeed: 4.5,
  soundPitch: 72,
  hornFrequencies: [440.0, 554.37, 659.25], // Sci-fi triple chime
  engineType: 'sawtooth',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Sleek Rocket Fuselage
    const fuselage = new THREE.ConeGeometry(1.2, 4.8, 12);
    fuselage.rotateX(Math.PI / 2);
    fuselage.translate(0, 0.9, 0.2);

    // 2. Cockpit Canopy (Glass Bubble)
    const cockpit = new THREE.SphereGeometry(0.85, 12, 10);
    cockpit.scale(0.9, 0.8, 1.4);
    cockpit.translate(0, 1.4, -0.2);

    // 3. Delta Wings
    const wingL = new THREE.BoxGeometry(1.6, 0.1, 1.8);
    wingL.translate(-1.4, 0.85, -0.8);

    const wingR = wingL.clone();
    wingR.translate(2.8, 0, 0);

    // 4. Twin Rocket Boosters on Tail
    const boosterL = new THREE.CylinderGeometry(0.35, 0.45, 1.6, 10);
    boosterL.rotateX(Math.PI / 2);
    boosterL.translate(-0.8, 1.0, -1.9);

    const boosterR = boosterL.clone();
    boosterR.translate(1.6, 0, 0);

    // 5. Glowing Rocket Exhaust Cones
    const exhaustL = new THREE.CylinderGeometry(0.38, 0.25, 0.4, 10);
    exhaustL.rotateX(Math.PI / 2);
    exhaustL.translate(-0.8, 1.0, -2.7);

    const exhaustR = exhaustL.clone();
    exhaustR.translate(1.6, 0, 0);

    // Vertex Colors
    const setGeoColor = (geo, colorHex) => {
      const col = new THREE.Color(colorHex);
      const count = geo.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = col.r;
        colors[i * 3 + 1] = col.g;
        colors[i * 3 + 2] = col.b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    };

    setGeoColor(fuselage, 0x8b5cf6);   // Galactic Purple Fuselage
    setGeoColor(cockpit, 0x38bdf8);    // Cyan Glass
    setGeoColor(wingL, 0xf43f5e);      // Neon Pink Wings
    setGeoColor(wingR, 0xf43f5e);
    setGeoColor(boosterL, 0x1e293b);   // Dark Thrusters
    setGeoColor(boosterR, 0x1e293b);
    setGeoColor(exhaustL, 0xf59e0b);   // Glowing Orange Exhaust
    setGeoColor(exhaustR, 0xf59e0b);

    const merged = mergeGeometries([
      fuselage, cockpit, wingL, wingR, boosterL, boosterR, exhaustL, exhaustR
    ]);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.25,
      metalness: 0.4,
    });
    const bodyMesh = new THREE.Mesh(merged, mat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 4 Neon Glow Wheels
    const wheels = [];
    const wheelPositions = [
      [-1.15, 0.55, 1.2],
      [1.15, 0.55, 1.2],
      [-1.3, 0.65, -1.2],
      [1.3, 0.65, -1.2],
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.38, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const tireMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.2 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, tireMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.4, 10), hubMat);
      hub.rotateZ(Math.PI / 2);
      wGroup.add(wMesh);
      wGroup.add(hub);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    const shadowGeo = new THREE.CircleGeometry(2.5, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x052e16,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    return { group, wheels };
  }
};
