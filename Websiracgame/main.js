import * as THREE from 'three';
import { PointerLockControls } from 'https://unpkg.com/three@0.158.0/examples/jsm/controls/PointerLockControls.js';

// --- SABİTLER ve GLOBAL AYARLAR ---
const CHUNK_SIZE = 16;
const RENDER_DISTANCE = 4;
const WATER_LEVEL = 5;
const playerHeight = 1.6;
const playerSpeed = 5;
const jumpStrength = 10;
const gravity = -30;
const reach = 5; // Bloğa erişim mesafesi

// Blok tipleri ve Malzemeler (Şimdilik renkli, Doku yükleme sonraki adım)
const BLOCK_MATERIALS = {
    'grass': new THREE.MeshLambertMaterial({ color: 0x4CAF50 }),
    'stone': new THREE.MeshLambertMaterial({ color: 0x9E9E9E }),
    'water': new THREE.MeshLambertMaterial({ color: 0x2196F3, transparent: true, opacity: 0.7 }),
    'default': new THREE.MeshLambertMaterial({ color: 0xFFFFFF }),
    'highlight': new THREE.MeshLambertMaterial({ color: 0xFFFF00, transparent: true, opacity: 0.5 }) // Vurgu rengi
};

// Voxel Geometrisini tekrar tekrar oluşturmamak için dışarıda tutalım
const VoxelGeometry = new THREE.BoxGeometry(1, 1, 1); 

// Yüklenen Chunk'ları ve Modifikasyonları saklamak için haritalar
const loadedChunks = {};
const worldModifications = {}; 
let currentBlockHighlight = null; // Vurgulanan blok
let selectedBlockType = 'stone'; // Başlangıçta konulacak blok

// Raycaster objesi
const raycaster = new THREE.Raycaster();
const playerDirection = new THREE.Vector3();

// --- DÜNYA OLUŞTURMA FONKSİYONLARI (Kısmen Aynı) ---

function getHeight(x, z) {
    return Math.floor((Math.sin(x * 0.1) + Math.cos(z * 0.1)) * 4) + 5;
}

function createVoxel(x, y, z, materialKey) {
    const material = BLOCK_MATERIALS[materialKey] || BLOCK_MATERIALS['default'];
    // Önemli: Three.js'te bloklar merkezlenir. 0.5 ekliyoruz.
    const voxel = new THREE.Mesh(VoxelGeometry, material); 
    voxel.position.set(x + 0.5, y + 0.5, z + 0.5); 
    
    // Koordinatları ve tipini kaydet
    voxel.userData = { x, y, z, type: materialKey };
    voxel.name = `voxel_${x}_${y}_${z}`; // Raycasting için isim veriyoruz
    
    scene.add(voxel);
    return voxel;
}

function generateChunk(cx, cz) {
    const chunkKey = `${cx},${cz}`;
    if (loadedChunks[chunkKey]) return;

    const chunkGroup = new THREE.Group();
    chunkGroup.name = chunkKey;
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;

    for (let x = startX; x < startX + CHUNK_SIZE; x++) {
        for (let z = startZ; z < startZ + CHUNK_SIZE; z++) {
            const y_height = getHeight(x, z);
            
            // --- ZEMİN OLUŞTURMA ---
            for (let y = 0; y < y_height; y++) {
                let materialKey = (y === y_height - 1) ? 'grass' : 'stone';
                const voxel = createVoxel(x, y, z, materialKey);
                chunkGroup.add(voxel);
            }

            // --- SU KÜTLESİ OLUŞTURMA ---
            if (y_height < WATER_LEVEL) {
                for (let y = y_height; y < WATER_LEVEL; y++) {
                    const waterVoxel = createVoxel(x, y, z, 'water');
                    chunkGroup.add(waterVoxel);
                }
            }
        }
    }
    
    // --- Yüklenen Modifikasyonları Uygula ---
    // (Şimdilik boş, Kaydet/Yükle sistemi eklendiğinde devreye girecek)

    scene.add(chunkGroup);
    loadedChunks[chunkKey] = chunkGroup;
}

function unloadChunk(cx, cz) {
    // ... (Önceki kodla aynı)
    const chunkKey = `${cx},${cz}`;
    const chunkGroup = loadedChunks[chunkKey];
    if (chunkGroup) {
        chunkGroup.traverse(child => {
            if (child.isMesh) {
                child.geometry.dispose();
                // child.material.dispose(); // Malzemeleri paylaştığımız için dispose etmiyoruz
            }
        });
        scene.remove(chunkGroup);
        delete loadedChunks[chunkKey];
    }
}

function getPlayerChunkPos() {
    const px = controls.getObject().position.x;
    const pz = controls.getObject().position.z;
    return { 
        cx: Math.floor(px / CHUNK_SIZE), 
        cz: Math.floor(pz / CHUNK_SIZE) 
    };
}

function updateChunks() {
    // ... (Önceki kodla aynı)
    const { cx: currentCx, cz: currentCz } = getPlayerChunkPos();
    const chunksToKeep = new Set();

    for (let i = -RENDER_DISTANCE; i <= RENDER_DISTANCE; i++) {
        for (let j = -RENDER_DISTANCE; j <= RENDER_DISTANCE; j++) {
            const targetKey = `${currentCx + i},${currentCz + j}`;
            chunksToKeep.add(targetKey);
            
            if (!loadedChunks[targetKey]) {
                generateChunk(currentCx + i, currentCz + j);
            }
        }
    }

    const keysToUnload = [];
    for (const key in loadedChunks) {
        if (!chunksToKeep.has(key)) {
            keysToUnload.push(key);
        }
    }
    for (const key of keysToUnload) {
        const [cx, cz] = key.split(',').map(Number);
        unloadChunk(cx, cz);
    }
}


// --- RAYCASTING ve ETKİLEŞİM FONKSİYONLARI ---

function updateRaycast() {
    if (!controls.isLocked) {
        if (currentBlockHighlight) {
            scene.remove(currentBlockHighlight);
            currentBlockHighlight = null;
        }
        return;
    }

    // Kamera pozisyonunu ve yönünü al
    camera.getWorldDirection(playerDirection);
    raycaster.set(camera.position, playerDirection);

    // Tüm yüklü bloklar üzerinde ışın kontrolü yap
    // (Bunu daha optimize etmemiz gerekebilir, şimdilik tüm mesh'leri alıyoruz)
    const intersectableObjects = [];
    scene.traverse(obj => {
        if (obj.isMesh && obj.name.startsWith('voxel_')) {
             intersectableObjects.push(obj);
        }
    });

    const intersects = raycaster.intersectObjects(intersectableObjects, false);

    if (intersects.length > 0) {
        const hit = intersects[0];
        if (hit.distance < reach) {
            const hitVoxel = hit.object;

            // Vurgulama Mesh'i zaten varsa, pozisyonunu güncelle
            if (!currentBlockHighlight) {
                currentBlockHighlight = new THREE.Mesh(VoxelGeometry, BLOCK_MATERIALS['highlight']);
                scene.add(currentBlockHighlight);
            }
            
            // Vurguyu blok üzerine oturt
            currentBlockHighlight.position.copy(hitVoxel.position);
            currentBlockHighlight.visible = true;
            return hitVoxel;
        }
    } 

    // Blok vurulmadıysa veya menzil dışındaysa vurguyu kaldır
    if (currentBlockHighlight) {
        currentBlockHighlight.visible = false;
    }
    return null; // Blok bulunamadı
}

function handleBlockInteraction(event) {
    if (!controls.isLocked) return;

    const hitVoxel = updateRaycast();

    if (hitVoxel) {
        const { x, y, z, type } = hitVoxel.userData;
        const blockCoord = `${x},${y},${z}`;

        if (event.button === 0) { // Sol Tık (Kırma)
            if (type !== 'water') { // Suyu kırmayı engelle (şimdilik)
                // Sahneden kaldır
                scene.remove(hitVoxel);
                hitVoxel.geometry.dispose();
                
                // Modifikasyon olarak kaydet (silindi)
                worldModifications[blockCoord] = null;
            }
        } else if (event.button === 2) { // Sağ Tık (Koyma)
            // Blokun normalini kullanarak yeni pozisyonu bul
            const newPos = hitVoxel.position.clone().add(hit.face.normal);
            
            // Yeni blokun merkezi yerine koordinatlarını hesapla
            const newX = Math.floor(newPos.x - 0.5);
            const newY = Math.floor(newPos.y - 0.5);
            const newZ = Math.floor(newPos.z - 0.5);
            const newBlockCoord = `${newX},${newY},${newZ}`;

            // Oyuncunun kendi içine blok koymasını engelle (basit kontrol)
            if (newY >= camera.position.y - playerHeight && newY < camera.position.y + 0.5) {
                 // Basit çarpışma kontrolü, ileride geliştirilebilir
            } else {
                // Yeni bloğu oluştur
                const newVoxel = createVoxel(newX, newY, newZ, selectedBlockType);
                
                // Modifikasyon olarak kaydet (yeni blok)
                worldModifications[newBlockCoord] = selectedBlockType; 
            }
        }
    }
}


// --- SAHNE KURULUMU ve KONTROLLER ---

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const ambientLight = new THREE.AmbientLight(0x404040, 5);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
directionalLight.position.set(5, 10, 5);
directionalLight.castShadow = true;
scene.add(directionalLight);

let controls;
let moveForward = false;
let moveBackward = false;
let moveLeft = false;
let moveRight = false;
let canJump = false; 
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
camera.position.set(CHUNK_SIZE * 0.5, WATER_LEVEL + 5 + playerHeight, CHUNK_SIZE * 0.5); // Başlangıç pozisyonu

const instructions = document.getElementById('instructions'); // HTML'den aldık
instructions.addEventListener('click', () => controls.lock());

controls = new PointerLockControls(camera, document.body);
scene.add(controls.getObject());

controls.addEventListener('lock', () => instructions.style.display = 'none');
controls.addEventListener('unlock', () => instructions.style.display = 'block');

// --- INPUTS ---
const onKeyDown = (event) => {
    switch (event.code) {
        case 'KeyW': moveForward = true; break;
        case 'KeyA': moveLeft = true; break;
        case 'KeyS': moveBackward = true; break;
        case 'KeyD': moveRight = true; break;
        case 'Space':
            if (canJump) {
                velocity.y += jumpStrength;
                canJump = false;
            }
            break;
        case 'Digit1': selectedBlockType = 'grass'; break; // Blok seçimi
        case 'Digit2': selectedBlockType = 'stone'; break;
        case 'Digit3': selectedBlockType = 'default'; break; // Yeni tip
    }
};

const onKeyUp = (event) => {
    switch (event.code) {
        case 'KeyW': moveForward = false; break;
        case 'KeyA': moveLeft = false; break;
        case 'KeyS': moveBackward = false; break;
        case 'KeyD': moveRight = false; break;
    }
};

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);
// Mouse olayları eklendi
document.addEventListener('mousedown', handleBlockInteraction);
document.addEventListener('contextmenu', (e) => e.preventDefault()); // Sağ tık menüsünü engelle

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ANİMASYON DÖNGÜSÜ ---
let prevTime = performance.now();

function animate() {
    requestAnimationFrame(animate);

    const time = performance.now();
    const delta = (time - prevTime) / 1000;

    if (controls.isLocked) {
        // Hareket ve yerçekimi mantığı (Aynı kaldı)
        velocity.x -= velocity.x * 10.0 * delta;
        velocity.z -= velocity.z * 10.0 * delta;
        velocity.y -= gravity * delta; 
        direction.z = Number(moveForward) - Number(moveBackward);
        direction.x = Number(moveRight) - Number(moveLeft);
        direction.normalize();
        if (moveForward || moveBackward) velocity.z -= direction.z * playerSpeed * delta;
        if (moveLeft || moveRight) velocity.x -= direction.x * playerSpeed * delta;
        controls.moveRight(-velocity.x * delta);
        controls.moveForward(-velocity.z * delta);
        controls.getObject().position.y += velocity.y * delta;
        if (controls.getObject().position.y < playerHeight) {
            velocity.y = 0;
            controls.getObject().position.y = playerHeight;
            canJump = true; 
        }

        // --- YENİ: Chunk ve Raycast Güncelleme ---
        updateChunks();
        updateRaycast(); // Hangi bloğa baktığımızı her karede kontrol et
    }

    prevTime = time; 
    renderer.render(scene, camera);
}

// OYUN BAŞLANGICI
updateChunks(); 
animate();
