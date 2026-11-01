/* Procedural Farm Tractor Vehicle */

export const TractorVehicle = {
  id: 'tractor',
  name: 'Farm Tractor',
  icon: '🚜',
  baseSpeed: 9.0,
  minSlowdownSpeed: 3.0,
  soundPitch: 42, // Classic tractor putt-putt chug
  hornFrequencies: [220.0, 277.18],
  engineType: 'sawtooth',

  createMesh(THREE, mergeGeometries) {
    const group = new THREE.Group();

    // 1. Engine Hood
    const hood = new THREE.BoxGeometry(1.6, 1.1, 2.4);
    hood.translate(0, 1.25, 0.8);

    // 2. Open Cabin / Rollover Hoop
    const cabRoof = new THREE.BoxGeometry(1.8, 0.15, 1.6);
    cabRoof.translate(0, 2.7, -0.6);

    const pillarFL = new THREE.CylinderGeometry(0.06, 0.06, 1.4, 8);
    pillarFL.translate(-0.8, 2.0, 0.1);

    const pillarFR = pillarFL.clone();
    pillarFR.translate(1.6, 0, 0);

    const pillarBL = pillarFL.clone();
    pillarBL.translate(0, 0, -1.4);

    const pillarBR = pillarFR.clone();
    pillarBR.translate(0, 0, -1.4);

    // 3. Driver Seat
    const seat = new THREE.BoxGeometry(1.0, 0.6, 0.8);
    seat.translate(0, 1.3, -0.6);

    // 4. Tall Vertical Exhaust Stack
    const exhaust = new THREE.CylinderGeometry(0.08, 0.1, 1.7, 8);
    exhaust.translate(0.65, 2.3, 1.5);

    const exhaustCap = new THREE.BoxGeometry(0.2, 0.05, 0.25);
    exhaustCap.translate(0.65, 3.16, 1.5);

    // 5. Front Grille & Headlights
    const grille = new THREE.BoxGeometry(1.3, 0.8, 0.2);
    grille.translate(0, 1.25, 2.01);

    const lightL = new THREE.CylinderGeometry(0.18, 0.18, 0.2, 10);
    lightL.rotateX(Math.PI / 2);
    lightL.translate(-0.55, 1.4, 2.02);

    const lightR = lightL.clone();
    lightR.translate(1.1, 0, 0);

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

    setGeoColor(hood, 0x16a34a);        // Classic Farm Green
    setGeoColor(cabRoof, 0xfef08a);     // Yellow Sun Canopy
    setGeoColor(pillarFL, 0x1e293b);
    setGeoColor(pillarFR, 0x1e293b);
    setGeoColor(pillarBL, 0x1e293b);
    setGeoColor(pillarBR, 0x1e293b);
    setGeoColor(seat, 0x0f172a);
    setGeoColor(exhaust, 0x334155);
    setGeoColor(exhaustCap, 0x334155);
    setGeoColor(grille, 0xfacc15);      // Yellow Grille
    setGeoColor(lightL, 0xfef08a);
    setGeoColor(lightR, 0xfef08a);

    const mergedBody = mergeGeometries([
      hood, cabRoof, pillarFL, pillarFR, pillarBL, pillarBR,
      seat, exhaust, exhaustCap, grille, lightL, lightR
    ]);

    const bodyMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.4,
      metalness: 0.2,
    });
    const bodyMesh = new THREE.Mesh(mergedBody, bodyMat);
    bodyMesh.castShadow = true;
    group.add(bodyMesh);

    // Tractor Wheels: 2 Small Front Wheels, 2 Giant Chunky Rear Wheels
    const wheels = [];

    // Front Wheels (Small)
    const fWheelGeo = new THREE.CylinderGeometry(0.48, 0.48, 0.35, 14);
    fWheelGeo.rotateZ(Math.PI / 2);
    const rWheelGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.55, 16);
    rWheelGeo.rotateZ(Math.PI / 2);

    const tireMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.3 }); // Yellow Rims

    // Front Left & Right
    [[-1.0, 0.48, 1.4], [1.0, 0.48, 1.4]].forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(fWheelGeo, tireMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.37, 10), rimMat);
      hub.rotateZ(Math.PI / 2);
      wGroup.add(wMesh);
      wGroup.add(hub);
      wGroup.position.set(...pos);
      group.add(wGroup);
      wheels.push(wGroup);
    });

    // Rear Left & Right (Giant Deep Tread Wheels)
    [[-1.25, 0.95, -0.8], [1.25, 0.95, -0.8]].forEach((pos) => {
      const wGroup = new THREE.Group();
      const wMesh = new THREE.Mesh(rWheelGeo, tireMat);
      wMesh.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.57, 12), rimMat);
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
