@group(0) @binding(0) var<uniform> posterScale: vec2f;
@group(0) @binding(1) var textureSampler: sampler;
@group(0) @binding(2) var posterTexture: texture_2d<f32>;

struct FragmentInput {
    @location(0) uv: vec2f,  
    @location(1) iuv: vec2f
}

@fragment
fn fs(input: FragmentInput) -> @location(0) vec4f {
    // Centered contain fit preserves every edge of the portrait; unused space stays black.
    let posterUV = (input.uv - vec2f(0.5)) / posterScale + vec2f(0.5);
    if (any(posterUV < vec2f(0.0)) || any(posterUV > vec2f(1.0))) {
        return vec4f(0.0, 0.0, 0.0, 1.0);
    }
    // Keep encoded sRGB values through the existing unorm background/compositing targets.
    return vec4f(textureSampleLevel(posterTexture, textureSampler, posterUV, 0.0).rgb, 1.0);
}
