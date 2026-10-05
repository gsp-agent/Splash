@group(0) @binding(0) var<uniform> uniforms: RenderUniforms;

struct RenderUniforms {
    texelSize: vec2f, 
    sphereSize: f32, 
    invProjectionMatrix: mat4x4f, 
    projectionMatrix: mat4x4f, 
    viewMatrix: mat4x4f, 
    invViewMatrix: mat4x4f, 
}

struct FragmentInput {
    @location(0) uv: vec2f,  
    @location(1) iuv: vec2f
}

fn computeViewPosFromUVDepth(texCoord: vec2f, depth: f32) -> vec3f {
    var ndc: vec4f = vec4f(texCoord.x * 2.0 - 1.0, 1.0 - 2.0 * texCoord.y, 0.0, 1.0);
    ndc.z = -uniforms.projectionMatrix[2].z + uniforms.projectionMatrix[3].z / depth;
    ndc.w = 1.0;

    var eye_pos: vec4f = uniforms.invProjectionMatrix * ndc;

    return eye_pos.xyz / eye_pos.w;
}

fn getCameraPosition() -> vec3f {
    return (uniforms.invViewMatrix * vec4(0, 0, 0, 1)).xyz;
}

@fragment
fn fs(input: FragmentInput) -> @location(0) vec4f {
    let cameraPos = getCameraPosition();
    let rayDirWorld = normalize((uniforms.invViewMatrix * vec4f(computeViewPosFromUVDepth(input.uv, 1.0), 0.)).xyz);
    let vignette = smoothstep(0.15, 0.85, length((input.uv - vec2f(0.5, 0.38)) * vec2f(1.0, 0.8)));
    let studioColor = vec3f(mix(0.88, 0.73, 0.55 * input.uv.y + 0.45 * vignette));

    // The cubemap lights the clay only; the visible studio stays neutral gray.
    let t = -cameraPos.y / min(rayDirWorld.y, -1e-6);
    let rayHitPos = cameraPos + t * rayDirWorld;
    let gridSize = 16.0;
    let gridDistance = abs(fract(rayHitPos.xz / gridSize - 0.5) - 0.5) * gridSize;
    let lineWidth = max(fwidth(rayHitPos.xz), vec2f(0.08));
    let gridLines = vec2f(1.0) - smoothstep(vec2f(0.08), vec2f(0.08) + lineWidth, gridDistance);
    let floorFade = (1.0 - smoothstep(80.0, 220.0, t)) * smoothstep(0.0, 0.1, -rayDirWorld.y);
    let grid = max(gridLines.x, gridLines.y) * floorFade;
    return vec4f(studioColor - vec3f(0.055 * grid), 1.0);
}
