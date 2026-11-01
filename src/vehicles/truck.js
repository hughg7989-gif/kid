/* Procedural Chunky Dump Truck Vehicle */

export const TruckVehicle = {
  id: 'truck',
  name: 'Dump Truck',
  icon: '🚛',
  baseSpeed: 10.0,
  minSlowdownSpeed: 3.4,
  soundPitch: 52, // Chunky work truck hum
  hornFrequencies: [196.0, 246.94], // Deep work truck horn
  engineType: 'sawtooth',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Lower Chassis
    const chassis = new THREE.BoxGeometry(2.3, 0.7, 5.2);
    chassis.translate(0, 0.7, 0);

    // 2. Cabin
    const cabin = new THREE.BoxGeometry(2.3, 1.8, 1.9);
    cabin.translate(0, 1.85, 1.5);

    // 3. Cabin Sun Visor
    const visor = new THREE.BoxGeometry(2.4, 0.2, 0.4);
    visor.translate(0, 2.75, 2.35);

    // 4. Windshield
    const windshield = new THREE.BoxGeometry(2.1, 0.8, 0.2);
    windshield.translate(0, 2.1, 2.46);

    // 5. Open Dump Bed
    const bedFloor = new THREE.BoxGeometry(2.4, 0.3, 3.1);
    bedFloor.translate(0, 1.25, -1.0);

    const bedWallL = new THREE.BoxGeometry(0.2, 1.2, 3.1);
    bedWallL.translate(-1.1, 1.9, -1.0);

    const bedWallR = new THREE.BoxGeometry(0.2, 1.2, 3.1);
    bedWallR.translate(1.1, 1.9, -1.0);

    const bedWallFront = new THREE.BoxGeometry(2.4, 1.4, 0.2);
    bedWallFront.translate(0, 2.0, 0.45);

    const bedWallBack = new THREE.BoxGeometry(2.4, 0.9, 0.2);
    bedWallBack.translate(0, 1.75, -2.45);

    // 6. Chrome Exhaust Stack
    const exhaust = new THREE.CylinderGeometry(0.12, 0.12, 1.8, 8);
    exhaust.translate(1.0, 2.5, 0.4);

    // 7. Heavy Bumper & Headlights
    const bumper = new THREE.BoxGeometry(2.5, 0.5, 0.4);
    bumper.translate(0, 0.6, 2.6);

    const headlightL = new THREE.CylinderGeometry(0.22, 0.22, 0.2, 10);
    headlightL.rotateX(Math.PI / 2);
    headlightL.translate(-0.8, 0.95, 2.5);

    const headlightR = headlightL.clone();
    headlightR.translate(1.6, 0, 0);

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

    setGeoColor(chassis, 0x1e293b);       // Dark chassis
    setGeoColor(cabin, 0x0284c7);         // Electric Cyan/Blue Cabin
    setGeoColor(visor, 0x0369a1);
    setGeoColor(windshield, 0xbae6fd);
    setGeoColor(bedFloor, 0xf97316);      // Safety Orange Dump Bed
    setGeoColor(bedWallL, 0xf97316);
    setGeoColor(bedWallR, 0xf97316);
    setGeoColor(bedWallFront, 0xf97316);
    setGeoColor(bedWallBack, 0xea580c);
    setGeoColor(exhaust, 0x94a3b8);       // Chrome metal
    setGeoColor(bumper, 0x0f172a);
    setGeoColor(headlightL, 0xfef08a);
    setGeoColor(headlightR, 0xfef08a);

    const mergedBody = mergeGeometries([
      chassis, cabin, visor, windshield,
      bedFloor, bedWallL, bedWallR, bedWallFront, bedWallBack,
      exhaust, bumper, headlightL, headlightR
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.35,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // 6 Big Truck Wheels
    const wheels = [];
    const wheelPositions = [
      [-1.25, 0.65, 1.6],
      [1.25, 0.65, 1.6],
      [-1.25, 0.65, -0.9],
      [1.25, 0.65, -0.9],
      [-1.25, 0.65, -1.9],
      [1.25, 0.65, -1.9],
    ];

    const wheelGeo = new THREE.CylinderGeometry(0.65, 0.65, 0.4, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
    const hubMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.4 });

    wheelPositions.forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(wheelGeo, wheelMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.42, 10), hubMat);
      hub.rotateZ(Math.PI / 2);
      wGroup.add(wMesh);
      wGroup.add(hub);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    const shadowGeo = new THREE.PlaneGeometry(3.2, 6.2);
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
