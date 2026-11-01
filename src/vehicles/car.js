/* Procedural Toy Sports Car */

export const CarVehicle = {
  id: 'car',
  name: 'Toy Race Car',
  icon: '🏎️',
  baseSpeed: 11.0,
  minSlowdownSpeed: 3.5,
  soundPitch: 65,
  hornFrequencies: [349.23, 440.0], // Sporty dual beep
  engineType: 'sawtooth',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Chassis
    const chassis = new THREE.BoxGeometry(2.2, 0.85, 4.2);
    chassis.translate(0, 0.75, 0);

    // 2. Cabin
    const cabin = new THREE.BoxGeometry(1.8, 0.85, 2.3);
    cabin.translate(0, 1.55, -0.2);

    // 3. Hood Slope
    const hoodSlope = new THREE.BoxGeometry(1.7, 0.45, 1.1);
    hoodSlope.translate(0, 1.15, 1.4);

    // 4. Bumpers
    const bumperFront = new THREE.BoxGeometry(2.3, 0.4, 0.4);
    bumperFront.translate(0, 0.5, 2.2);

    const bumperBack = new THREE.BoxGeometry(2.3, 0.4, 0.4);
    bumperBack.translate(0, 0.5, -2.2);

    // 5. Rear Spoiler
    const spoilerWing = new THREE.BoxGeometry(2.4, 0.15, 0.6);
    spoilerWing.translate(0, 2.1, -1.9);

    const spoilerPostL = new THREE.BoxGeometry(0.15, 0.6, 0.2);
    spoilerPostL.translate(-0.8, 1.75, -1.9);

    const spoilerPostR = spoilerPostL.clone();
    spoilerPostR.translate(1.6, 0, 0);

    // 6. Headlights
    const headlightL = new THREE.CylinderGeometry(0.2, 0.2, 0.2, 10);
    headlightL.rotateX(Math.PI / 2);
    headlightL.translate(-0.7, 0.85, 2.12);

    const headlightR = headlightL.clone();
    headlightR.translate(1.4, 0, 0);

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

    setGeoColor(chassis, 0xef4444);      // Vibrant Racing Red
    setGeoColor(cabin, 0x38bdf8);        // Tinted Glass Blue Windshield
    setGeoColor(hoodSlope, 0xdc2626);    // Deep Red Hood
    setGeoColor(bumperFront, 0x1e293b);  // Slate Dark Bumper
    setGeoColor(bumperBack, 0x1e293b);
    setGeoColor(spoilerWing, 0x1e293b);  // Carbon Dark Wing
    setGeoColor(spoilerPostL, 0xef4444);
    setGeoColor(spoilerPostR, 0xef4444);
    setGeoColor(headlightL, 0xfef08a);   // Yellow Glowing Lamps
    setGeoColor(headlightR, 0xfef08a);

    const mergedBody = mergeGeometries([
      chassis, cabin, hoodSlope, bumperFront, bumperBack,
      spoilerWing, spoilerPostL, spoilerPostR, headlightL, headlightR
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.25,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 4 Sport Wheels
    const wheels = [];
    const wheelPositions = [
      [-1.15, 0.55, 1.3],
      [1.15, 0.55, 1.3],
      [-1.15, 0.55, -1.3],
      [1.15, 0.55, -1.3],
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.3 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.42, 10), hubMat);
      hub.rotateZ(Math.PI / 2);
      wGroup.add(wMesh);
      wGroup.add(hub);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Contact shadow
    const shadowGeo = new THREE.CircleGeometry(2.4, 16);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x052e16,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    return { group, wheels };
  }
};
