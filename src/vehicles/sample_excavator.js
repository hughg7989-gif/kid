/* Procedural Construction Excavator Vehicle */

export const ExcavatorVehicle = {
  id: 'excavator',
  name: 'Yellow Excavator',
  icon: '🏗️',
  baseSpeed: 8.5,            // Slower, powerful construction vehicle (reference: normal car = 11.0)
  minSlowdownSpeed: 4.0,     // Stronger push-through capability
  soundPitch: 40,            // Heavy diesel engine thrum
  hornFrequencies: [220.0, 293.66], // Deep industrial horn
  engineType: 'triangle',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Lower Track Chassis (Black Caterpillar treads)
    const trackL = new THREE.BoxGeometry(0.7, 0.7, 4.4);
    trackL.translate(-1.1, 0.45, 0);

    const trackR = new THREE.BoxGeometry(0.7, 0.7, 4.4);
    trackR.translate(1.1, 0.45, 0);

    const trackCenter = new THREE.BoxGeometry(1.6, 0.4, 3.2);
    trackCenter.translate(0, 0.5, 0);

    // 2. Rotating Body Cabin (High-Vis Construction Yellow)
    const cabin = new THREE.BoxGeometry(2.3, 1.8, 3.2);
    cabin.translate(0, 1.7, -0.2);

    // 3. Operator Glass Cockpit
    const glass = new THREE.BoxGeometry(1.0, 1.4, 1.4);
    glass.translate(-0.55, 1.9, 0.6);

    // 4. Counterweight on Back
    const counterweight = new THREE.BoxGeometry(2.3, 1.6, 0.8);
    counterweight.translate(0, 1.6, -1.9);

    // 5. Heavy Boom Arm
    const boomBase = new THREE.BoxGeometry(0.4, 0.5, 2.6);
    boomBase.rotateX(-0.5);
    boomBase.translate(0.5, 2.4, 1.6);

    const boomStick = new THREE.BoxGeometry(0.35, 0.4, 2.4);
    boomStick.rotateX(0.7);
    boomStick.translate(0.5, 2.7, 3.2);

    // 6. Excavator Digging Bucket (Metal Scoop)
    const bucket = new THREE.BoxGeometry(1.4, 0.8, 1.0);
    bucket.rotateX(0.2);
    bucket.translate(0.5, 1.2, 4.1);

    // 7. Roof Flashing Amber Beacon
    const beacon = new THREE.CylinderGeometry(0.18, 0.22, 0.35, 10);
    beacon.translate(-0.55, 2.8, 0.6);

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

    setGeoColor(trackL, 0x1e293b);          // Dark Rubber Treads
    setGeoColor(trackR, 0x1e293b);
    setGeoColor(trackCenter, 0x334155);
    setGeoColor(cabin, 0xfacc15);           // High-Vis Caterpillar Yellow
    setGeoColor(glass, 0x38bdf8);           // Tinted Cockpit Glass
    setGeoColor(counterweight, 0x0f172a);   // Dark Steel Counterweight
    setGeoColor(boomBase, 0xfacc15);        // Yellow Boom
    setGeoColor(boomStick, 0xfacc15);
    setGeoColor(bucket, 0x475569);          // Tough Steel Bucket
    setGeoColor(beacon, 0xf97316);          // Safety Amber Light

    const mergedBody = mergeGeometries([
      trackL, trackR, trackCenter, cabin, glass,
      counterweight, boomBase, boomStick, bucket, beacon
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 6 Track Rollers (3 per side)
    const wheels = [];
    const wheelPositions = [
      [-1.1, 0.4, 1.4],
      [-1.1, 0.4, 0.0],
      [-1.1, 0.4, -1.4],
      [1.1, 0.4, 1.4],
      [1.1, 0.4, 0.0],
      [1.1, 0.4, -1.4],
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.4, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.8 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      wGroup.add(wMesh);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Contact shadow
    const shadowGeo = new THREE.PlaneGeometry(3.4, 5.8);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x052e16,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    group.add(shadow);

    return { group, wheels };
  }
};

export default ExcavatorVehicle;
