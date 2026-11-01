/* Procedural Yellow School Bus Vehicle */

export const BusVehicle = {
  id: 'bus',
  name: 'School Bus',
  icon: '🚌',
  baseSpeed: 9.5,
  minSlowdownSpeed: 3.2,
  soundPitch: 48, // Deeper, friendly diesel engine rumble
  hornFrequencies: [261.63, 329.63], // Chunky bus horn
  engineType: 'triangle',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Main Bus Body (Long Box)
    const body = new THREE.BoxGeometry(2.3, 2.1, 5.8);
    body.translate(0, 1.6, -0.2);

    // 2. Front Engine Hood
    const hood = new THREE.BoxGeometry(2.1, 1.1, 1.4);
    hood.translate(0, 1.05, 2.5);

    // 3. Front Grille
    const grille = new THREE.BoxGeometry(1.6, 0.7, 0.2);
    grille.translate(0, 0.95, 3.21);

    // 4. Heavy Bumpers
    const bumperFront = new THREE.BoxGeometry(2.5, 0.45, 0.4);
    bumperFront.translate(0, 0.55, 3.25);

    const bumperBack = new THREE.BoxGeometry(2.5, 0.45, 0.4);
    bumperBack.translate(0, 0.55, -3.2);

    // 5. Front Windshield
    const windshield = new THREE.BoxGeometry(2.1, 0.9, 0.2);
    windshield.translate(0, 1.95, 2.71);

    // 6. Side Windows Band Left
    const windowStripL = new THREE.BoxGeometry(0.15, 0.75, 4.8);
    windowStripL.translate(-1.16, 2.0, -0.4);

    // 7. Side Windows Band Right
    const windowStripR = new THREE.BoxGeometry(0.15, 0.75, 4.8);
    windowStripR.translate(1.16, 2.0, -0.4);

    // 8. Roof Warning Lights & Emergency Hatch
    const roofHatch = new THREE.BoxGeometry(1.4, 0.15, 1.4);
    roofHatch.translate(0, 2.72, -0.5);

    const lightFL = new THREE.CylinderGeometry(0.18, 0.18, 0.2, 10);
    lightFL.rotateX(Math.PI / 2);
    lightFL.translate(-0.8, 1.0, 3.22);

    const lightFR = lightFL.clone();
    lightFR.translate(1.6, 0, 0);

    // Set vertex colors
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

    setGeoColor(body, 0xfacc15);          // Iconic School Bus Yellow
    setGeoColor(hood, 0xfacc15);
    setGeoColor(grille, 0x334155);        // Dark chrome grille
    setGeoColor(bumperFront, 0x0f172a);   // Heavy black bumper
    setGeoColor(bumperBack, 0x0f172a);
    setGeoColor(windshield, 0x38bdf8);    // Clear sky blue glass
    setGeoColor(windowStripL, 0x38bdf8);
    setGeoColor(windowStripR, 0x38bdf8);
    setGeoColor(roofHatch, 0xf59e0b);     // Amber hatch
    setGeoColor(lightFL, 0xfef08a);       // Bright lamps
    setGeoColor(lightFR, 0xfef08a);

    const mergedBody = mergeGeometries([
      body, hood, grille, bumperFront, bumperBack,
      windshield, windowStripL, windowStripR, roofHatch, lightFL, lightFR
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.15,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 6 Chunky Wheels (Dual wheels on rear axle)
    const wheels = [];
    const wheelPositions = [
      [-1.25, 0.6, 1.8],   // Front L
      [1.25, 0.6, 1.8],    // Front R
      [-1.25, 0.6, -1.6],  // Rear Outer L
      [-1.0, 0.6, -1.6],   // Rear Inner L
      [1.25, 0.6, -1.6],   // Rear Outer R
      [1.0, 0.6, -1.6],    // Rear Inner R
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.6, 0.6, 0.35, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.8 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.3 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.37, 10), hubMat);
      hub.rotateZ(Math.PI / 2);
      wGroup.add(wMesh);
      wGroup.add(hub);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Contact shadow
    const shadowGeo = new THREE.PlaneGeometry(3.0, 7.0);
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
